import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isRecord } from './json.ts';

/**
 * Merges of one repo land oldest first (T4196). Each `ship.ts merge` process writes a ticket when it starts, under
 * the repo's git common dir, so every worktree of the repo sees it. A merge whose checks passed waits while an older
 * merge's ticket is live, then reads main: it is caught up once for all the older merges that landed meanwhile,
 * where it would otherwise be caught up once per merge that landed during its own CI wait, and refused at the third
 * (MERGE_ATTEMPTS in merge.ts).
 *
 * Only an older merge that is ready, whose checks passed, holds the turn: it lands within minutes, or catches up and
 * holds the turn through that catch-up's checks. An older merge still in its first CI wait does not: waiting on it
 * held a green merge the whole `timeoutMs` behind merges that were themselves waiting, after which all of them landed
 * at once and main moved past each again (T4196, T4270 and T4259 merges refused 11-18).
 *
 * A ticket is live while its process runs and its heartbeat is fresh: Windows hands an ended process's id to a new
 * one within seconds under load (T990), so a running id alone could hold every newer merge back. A process that
 * ended without removing its ticket frees the turn at once, one whose id was reused at most `staleMs` after its
 * last beat. A wait gives up after `timeoutMs` and lands as before, saying so.
 *
 * A release merge opens the release lane once its head is cleared (T5132): each merge to main makes the release tool
 * rewrite the release head, restarting its checks, so the release could keep losing its turn to newer merges. While
 * a live lane is open, every other merge of the repo whose checks passed is held, older ones too, until the release
 * merge ends (it landed or failed) or the lane's cap passes, so a stuck release never holds the team for longer. The
 * release merge itself waits on nobody: a merge it waited on would be held by its lane.
 */

/** The release lane a release merge opened: other merges of the repo wait until it ends or `until` passes. */
export interface Lane {
  /** The release task whose merge opened it, named on each held merge. */
  readonly task: string;
  /** When the hold ends at the latest, in ms since the epoch. */
  readonly until: number;
}

/** One merge's place in line. */
export interface Ticket {
  readonly pid: number;
  /** When its merge started, in ms since the epoch: the order merges land in. */
  readonly startedAt: number;
  /** Its last heartbeat, in ms since the epoch. */
  readonly beatAt: number;
  /** When its checks first passed, in ms since the epoch; null while it waits on them, and in a ticket written before readyAt. */
  readonly readyAt: number | null;
  /** The release lane this merge opened; null for any other merge, and in a ticket written before lanes. */
  readonly lane: Lane | null;
}

/** Where the repo's tickets are kept, one per process. */
export interface TicketStore {
  list(): readonly Ticket[];
  /** Writes `ticket`, replacing its process's earlier one. */
  write(ticket: Ticket): void;
  remove(pid: number): void;
}

export interface TurnClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface TurnDeps {
  readonly store: TicketStore;
  readonly pid: number;
  /** Whether a process holds the id. */
  readonly pidAlive: (pid: number) => boolean;
  readonly clock: TurnClock;
}

export interface TurnTimes {
  /** How often a waiting merge looks again. */
  readonly pollMs: number;
  /** How long a ticket stays live past its last beat. */
  readonly staleMs: number;
  /** How long a merge waits for older ones at most before it lands anyway. */
  readonly timeoutMs: number;
}

/** A beat each 30 s keeps a ticket live; a catch-up's build blocks the beat for minutes, so 10 min of silence are allowed. */
export const TURN_TIMES: TurnTimes = { pollMs: 30_000, staleMs: 10 * 60_000, timeoutMs: 20 * 60_000 };

export interface LandingTurn {
  /**
   * Marks this merge ready, its checks passed, then waits while an older ready merge of the repo is live, at most
   * `timeoutMs`; says what it waited on. It stays ready through its catch-ups, so newer merges wait on them.
   */
  wait(log: (line: string) => void): Promise<void>;
  /**
   * How many waits ended because the older merges it waited on landed or ended, not at the time out: each such wait
   * likely moved main by design, so the move a merge reads next is not one it lost a race to (T4280).
   */
  waited(): number;
  /**
   * Opens the release lane of `task` for at most `capMs` from now, once; a later call keeps the first lane, so a
   * catch-up never extends the hold. A cap of 0 opens none. True when this call opened it.
   */
  openLane(task: string, capMs: number): boolean;
  /** Marks this merge live now. */
  beat(): void;
  /** Leaves the line. */
  end(): void;
}

const olderThan = (ticket: Ticket, own: Pick<Ticket, 'pid' | 'startedAt'>): boolean =>
  ticket.startedAt < own.startedAt || (ticket.startedAt === own.startedAt && ticket.pid < own.pid);

const clockOf = (ms: number): string => new Date(ms).toISOString().slice(11, 19);

/** Takes this process's place in line now: its merge's start is the order it lands in. */
export function landingTurn(deps: TurnDeps, times: TurnTimes = TURN_TIMES): LandingTurn {
  const { store, pid, pidAlive, clock } = deps;
  const startedAt = clock.now();
  // The line only orders merges, so a write another process's read blocks on Windows never stops one: a missed beat
  // is made at the next, and a ticket left behind goes stale.
  const tried = (write: () => void): void => {
    try {
      write();
    } catch {
      // Made again at the next beat, or left to go stale.
    }
  };
  let readyAt: number | null = null;
  let lane: Lane | null = null;
  const beat = (): void => tried(() => store.write({ pid, startedAt, beatAt: clock.now(), readyAt, lane }));
  beat();
  const own = { pid, startedAt };

  /** The other live tickets; a dead one is removed, so the next reader skips it at once. */
  const live = (): Ticket[] => {
    const now = clock.now();
    return store.list().filter(ticket => {
      if (ticket.pid === pid) return false;
      if (pidAlive(ticket.pid) && now - ticket.beatAt <= times.staleMs) return true;
      tried(() => store.remove(ticket.pid));
      return false;
    });
  };

  /** The open release lane of another live merge, the one that holds longest; null when none is open now. */
  const laneOf = (tickets: readonly Ticket[]): Lane | null => {
    const now = clock.now();
    const open = tickets.flatMap(ticket => (ticket.lane !== null && now < ticket.lane.until ? [ticket.lane] : []));
    return open.reduce<Lane | null>((longest, next) => (longest === null || next.until > longest.until ? next : longest), null);
  };

  /** How a hold by a release lane ended: `ended` when its release merge ended, which likely moved main by design (T4280). */
  const laneEnd = (held: Lane, heldSince: number, log: (line: string) => void): 'ended' | 'capped' => {
    const after = Math.round((clock.now() - heldSince) / 1000);
    if (clock.now() >= held.until) {
      log(`the release lane of ${held.task} reached its cap at ${clockOf(held.until)} UTC: going on after ${after} s`);
      return 'capped';
    }
    log(`the release lane of ${held.task} ended, its release landed or failed: going on after ${after} s`);
    return 'ended';
  };

  let landedWaits = 0;
  return {
    beat,
    end: () => tried(() => store.remove(pid)),
    waited: () => landedWaits,
    openLane: (task, capMs) => {
      if (lane !== null || capMs <= 0) return false;
      lane = { task, until: clock.now() + capMs };
      beat();
      return true;
    },
    wait: async log => {
      readyAt ??= clock.now();
      // The release merge holds the others: waiting on any of them would wait on a merge its own lane holds.
      if (lane !== null) {
        beat();
        return;
      }
      let movedByDesign = false;
      let held: Lane | null = null;
      let heldSince = 0;
      // The time out for older merges counts from the end of the last hold by a lane, which has its own cap.
      let since = clock.now();
      let said = '';
      for (;;) {
        beat();
        const tickets = live();
        const open = laneOf(tickets);
        if (open !== null) {
          if (held === null) heldSince = clock.now();
          if (held?.task !== open.task || held.until !== open.until) {
            log(`checks passed; held by the release lane of ${open.task} until it lands or fails, at most until ${clockOf(open.until)} UTC`);
          }
          held = open;
          await clock.sleep(Math.min(times.pollMs, Math.max(open.until - clock.now(), 1)));
          continue;
        }
        if (held !== null) {
          if (laneEnd(held, heldSince, log) === 'ended') movedByDesign = true;
          held = null;
          since = clock.now();
          said = '';
        }
        const older = tickets.filter(ticket => olderThan(ticket, own) && ticket.readyAt !== null);
        if (older.length === 0) {
          if (said !== '') {
            movedByDesign = true;
            log(`older merges landed or ended: going on after ${Math.round((clock.now() - since) / 1000)} s`);
          }
          if (movedByDesign) landedWaits += 1;
          return;
        }
        if (clock.now() - since >= times.timeoutMs) {
          if (movedByDesign) landedWaits += 1;
          log(`waited ${times.timeoutMs / 60_000} min for older merges (${said}): landing anyway`);
          return;
        }
        const names = older.map(ticket => `pid ${ticket.pid} started ${clockOf(ticket.startedAt)} UTC`).join(', ');
        if (names !== said) log(`checks passed; waiting for ${older.length} older merge(s) of this repo to land first: ${names}`);
        said = names;
        await clock.sleep(times.pollMs);
      }
    },
  };
}

/** A ticket read back, or null when the file is torn or not one. */
export function parseTicket(text: string): Ticket | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;
  const { pid, startedAt, beatAt, readyAt = null, lane = null } = body;
  if (typeof pid !== 'number' || typeof startedAt !== 'number' || typeof beatAt !== 'number') return null;
  if (readyAt !== null && typeof readyAt !== 'number') return null;
  if (lane === null) return { pid, startedAt, beatAt, readyAt, lane };
  if (!isRecord(lane) || typeof lane['task'] !== 'string' || typeof lane['until'] !== 'number') return null;
  return { pid, startedAt, beatAt, readyAt, lane: { task: lane['task'], until: lane['until'] } };
}

/** Tickets as `<pid>.json` files in `dir`, each written whole by a rename, so a reader never sees half of one. */
export function fileTicketStore(dir: string): TicketStore {
  const fileOf = (pid: number): string => join(dir, `${pid}.json`);
  return {
    list: () => {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return [];
      }
      const tickets: Ticket[] = [];
      for (const name of names.filter(file => /^\d+\.json$/.test(file))) {
        try {
          const ticket = parseTicket(readFileSync(join(dir, name), 'utf8'));
          if (ticket !== null) tickets.push(ticket);
        } catch {
          // Removed while listed: its merge ended.
        }
      }
      return tickets;
    },
    write: ticket => {
      mkdirSync(dir, { recursive: true });
      const part = `${fileOf(ticket.pid)}.part`;
      writeFileSync(part, JSON.stringify(ticket));
      renameSync(part, fileOf(ticket.pid));
    },
    remove: ticketPid => rmSync(fileOf(ticketPid), { force: true }),
  };
}

/** The tickets' folder: `ship-landing` in the git common dir, which every worktree of the repo shares. */
export function landingDirOf(dir: string, git: (...args: string[]) => string): string {
  return join(resolve(dir, git('rev-parse', '--git-common-dir')), 'ship-landing');
}

/** Signal 0 only checks: EPERM is a process of another user, which runs too. */
export function signalAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

let processTurn: LandingTurn | null = null;

/**
 * This process's turn, taken on the first call: a ship's own merge builds new deps each time main moves (mergeBranch),
 * and its place in line stays its first start. It beats while the process runs and leaves the line as it exits.
 */
export function processLandingTurn(dir: string, git: (...args: string[]) => string): LandingTurn {
  if (processTurn !== null) return processTurn;
  const turn = landingTurn({
    store: fileTicketStore(landingDirOf(dir, git)),
    pid: process.pid,
    pidAlive: signalAlive,
    clock: { now: () => Date.now(), sleep: ms => new Promise(done => setTimeout(done, ms)) },
  });
  setInterval(() => turn.beat(), TURN_TIMES.pollMs).unref();
  process.on('exit', () => turn.end());
  processTurn = turn;
  return turn;
}
