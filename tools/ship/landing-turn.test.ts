import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileTicketStore, landingDirOf, landingTurn, parseTicket, signalAlive, type Ticket, type TicketStore, type TurnClock, type TurnTimes } from './landing-turn.ts';

const TIMES: TurnTimes = { pollMs: 1000, staleMs: 10_000, timeoutMs: 60_000 };

interface FakeLine {
  store: TicketStore;
  tickets: Map<number, Ticket>;
  clock: TurnClock & { slept: number[]; at(ms: number, run: () => void): void };
}

/** Tickets in memory, and a clock whose sleep moves time on and runs what was due by then. */
function fakeLine(start = 1_000_000): FakeLine {
  const tickets = new Map<number, Ticket>();
  let now = start;
  const slept: number[] = [];
  const due: { ms: number; run: () => void }[] = [];
  return {
    tickets,
    store: {
      list: () => [...tickets.values()],
      write: ticket => tickets.set(ticket.pid, ticket),
      remove: pid => tickets.delete(pid),
    },
    clock: {
      slept,
      now: () => now,
      sleep: ms => {
        slept.push(ms);
        now += ms;
        for (const event of due.filter(item => item.ms <= now)) {
          due.splice(due.indexOf(event), 1);
          event.run();
        }
        return Promise.resolve();
      },
      at: (ms, run) => due.push({ ms: start + ms, run }),
    },
  };
}

const alive = (pids: ReadonlySet<number>) => (pid: number): boolean => pids.has(pid);

/** A merge whose checks passed when it started. */
const ready = (pid: number, startedAt: number, beatAt: number): Ticket => ({ pid, startedAt, beatAt, readyAt: startedAt, lane: null });

/** A merge still waiting on its checks. */
const inChecks = (pid: number, startedAt: number, beatAt: number): Ticket => ({ pid, startedAt, beatAt, readyAt: null, lane: null });

/** A release merge of task T9 waiting on its checks, its lane open until `until` (T5132). */
const releasing = (pid: number, startedAt: number, beatAt: number, until: number): Ticket => ({ ...inChecks(pid, startedAt, beatAt), lane: { task: 'T9', until } });

test('a merge takes its place in line when it starts, not ready, and leaves it as it ends', () => {
  const line = fakeLine();
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: alive(new Set([7])), clock: line.clock }, TIMES);
  assert.deepEqual(line.tickets.get(7), inChecks(7, 1_000_000, 1_000_000));
  turn.end();
  assert.equal(line.tickets.size, 0);
});

test('with no older merge in line it goes on at once and says nothing', async () => {
  const line = fakeLine();
  line.tickets.set(9, ready(9, 2_000_000, 2_000_000));
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: alive(new Set([7, 9])), clock: line.clock }, TIMES);
  const said: string[] = [];
  await turn.wait(line => said.push(line));
  assert.deepEqual(said, []);
  assert.deepEqual(line.clock.slept, []);
  assert.equal(line.tickets.has(9), true, 'a newer merge keeps its ticket');
});

test('waits while an older live merge is in line, then goes on once its ticket is gone (T4196)', async () => {
  const line = fakeLine();
  line.tickets.set(5, ready(5, 999_000, 999_000));
  const pids = new Set([5, 7]);
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: alive(pids), clock: line.clock }, TIMES);
  // The older merge beats while it waits on its checks, then lands and leaves the line.
  line.clock.at(1000, () => line.tickets.set(5, ready(5, 999_000, 1_001_000)));
  line.clock.at(3000, () => line.tickets.delete(5));
  const said: string[] = [];
  await turn.wait(text => said.push(text));
  assert.deepEqual(line.clock.slept, [1000, 1000, 1000]);
  assert.deepEqual(said, [
    'checks passed; waiting for 1 older merge(s) of this repo to land first: pid 5 started 00:16:39 UTC',
    'older merges landed or ended: going on after 3 s',
  ]);
  assert.equal(line.tickets.get(7)?.beatAt, 1_003_000, 'it beats each look');
});

test('counts only the waits older merges ended by landing, not one with none ahead or one that timed out (T4280)', async () => {
  const line = fakeLine();
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: () => true, clock: line.clock }, TIMES);
  await turn.wait(() => undefined);
  assert.equal(turn.waited(), 0, 'nothing ahead: no wait');
  line.tickets.set(5, ready(5, 999_000, 1_000_000));
  line.clock.at(1000, () => line.tickets.delete(5));
  await turn.wait(() => undefined);
  assert.equal(turn.waited(), 1, 'the older merge landed');
  line.tickets.set(4, ready(4, 998_000, 1_001_000));
  for (let ms = 1000; ms <= 1000 + TIMES.timeoutMs; ms += TIMES.pollMs) line.clock.at(ms, () => line.tickets.set(4, ready(4, 998_000, 1_000_000 + ms)));
  await turn.wait(() => undefined);
  assert.equal(turn.waited(), 1, 'a timed-out wait is not counted');
});

test('an older ticket whose process ended frees the turn at once and is removed', async () => {
  const line = fakeLine();
  line.tickets.set(5, ready(5, 999_000, 1_000_000));
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: alive(new Set([7])), clock: line.clock }, TIMES);
  await turn.wait(() => undefined);
  assert.deepEqual(line.clock.slept, []);
  assert.equal(line.tickets.has(5), false);
});

test("an older ticket past its heartbeat's stale time is not waited on, though a process holds its id (Windows reuses ids)", async () => {
  const line = fakeLine();
  line.tickets.set(5, ready(5, 900_000, 1_000_000 - TIMES.staleMs - 1));
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: alive(new Set([5, 7])), clock: line.clock }, TIMES);
  await turn.wait(() => undefined);
  assert.deepEqual(line.clock.slept, []);
  assert.equal(line.tickets.has(5), false);
});

test('two merges started at the same ms land in pid order', async () => {
  const line = fakeLine();
  line.tickets.set(9, ready(9, 1_000_000, 1_000_000));
  line.tickets.set(3, ready(3, 1_000_000, 1_000_000));
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: alive(new Set([3, 7, 9])), clock: line.clock }, TIMES);
  line.clock.at(1000, () => line.tickets.delete(3));
  const said: string[] = [];
  await turn.wait(text => said.push(text));
  assert.match(said[0] ?? '', /: pid 3 started/);
  assert.deepEqual(line.clock.slept, [1000]);
});

test('names the older merges again only when they change', async () => {
  const line = fakeLine();
  line.tickets.set(4, ready(4, 998_000, 1_000_000));
  line.tickets.set(5, ready(5, 999_000, 1_000_000));
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: alive(new Set([4, 5, 7])), clock: line.clock }, TIMES);
  line.clock.at(2000, () => line.tickets.delete(4));
  line.clock.at(4000, () => line.tickets.delete(5));
  const said: string[] = [];
  await turn.wait(text => said.push(text));
  assert.equal(said.length, 3);
  assert.match(said[0] ?? '', /2 older merge\(s\).*pid 4.*pid 5/);
  assert.match(said[1] ?? '', /1 older merge\(s\).*pid 5/);
});

test('gives up after its time out and lands anyway, saying so', async () => {
  const line = fakeLine();
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: () => true, clock: line.clock }, TIMES);
  // The older merge keeps beating and never lands.
  for (let ms = 0; ms <= TIMES.timeoutMs; ms += TIMES.pollMs) line.clock.at(ms, () => line.tickets.set(5, ready(5, 999_000, 1_000_000 + ms)));
  line.tickets.set(5, ready(5, 999_000, 1_000_000));
  const said: string[] = [];
  await turn.wait(text => said.push(text));
  assert.equal(line.clock.slept.length, TIMES.timeoutMs / TIMES.pollMs);
  assert.match(said.at(-1) ?? '', /^waited 1 min for older merges \(pid 5 started .*\): landing anyway$/);
});

test('a store that cannot write or remove never stops the merge', async () => {
  const line = fakeLine();
  line.tickets.set(5, ready(5, 999_000, 1_000_000));
  const broken: TicketStore = {
    list: line.store.list,
    write: () => {
      throw new Error('EPERM: rename');
    },
    remove: () => {
      throw new Error('EPERM: unlink');
    },
  };
  const turn = landingTurn({ store: broken, pid: 7, pidAlive: alive(new Set([7])), clock: line.clock }, TIMES);
  await turn.wait(() => undefined);
  turn.beat();
  turn.end();
  assert.deepEqual(line.clock.slept, []);
});

test('an older merge still waiting on its checks does not hold a merge whose checks passed (T4196)', async () => {
  const line = fakeLine();
  line.tickets.set(4, inChecks(4, 998_000, 1_000_000));
  line.tickets.set(5, inChecks(5, 999_000, 1_000_000));
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: alive(new Set([4, 5, 7])), clock: line.clock }, TIMES);
  const said: string[] = [];
  await turn.wait(text => said.push(text));
  assert.deepEqual(line.clock.slept, [], 'it lands at once');
  assert.deepEqual(said, []);
  assert.equal(line.tickets.has(4) && line.tickets.has(5), true, 'a live merge in its checks keeps its ticket');
});

test('an older merge that turns ready while a newer one waits holds it until it lands', async () => {
  const line = fakeLine();
  line.tickets.set(4, ready(4, 998_000, 1_000_000));
  line.tickets.set(5, inChecks(5, 999_000, 1_000_000));
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: alive(new Set([4, 5, 7])), clock: line.clock }, TIMES);
  line.clock.at(1000, () => line.tickets.set(5, { ...inChecks(5, 999_000, 1_001_000), readyAt: 1_001_000 }));
  line.clock.at(2000, () => line.tickets.delete(4));
  line.clock.at(3000, () => line.tickets.delete(5));
  const said: string[] = [];
  await turn.wait(text => said.push(text));
  assert.deepEqual(line.clock.slept, [1000, 1000, 1000]);
  assert.match(said[0] ?? '', /1 older merge\(s\).*pid 4 started/);
  assert.match(said[1] ?? '', /2 older merge\(s\).*pid 4.*pid 5/);
  assert.match(said[2] ?? '', /1 older merge\(s\).*pid 5 started/);
});

test('a merge turns ready as it first waits, and stays ready through its catch-ups', async () => {
  const line = fakeLine();
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: alive(new Set([7])), clock: line.clock }, TIMES);
  await line.clock.sleep(5000);
  await turn.wait(() => undefined);
  assert.equal(line.tickets.get(7)?.readyAt, 1_005_000);
  // Main moved: its catch-up runs its checks again, beating meanwhile, and waits again once they pass.
  await line.clock.sleep(60_000);
  turn.beat();
  assert.equal(line.tickets.get(7)?.readyAt, 1_005_000, 'a beat in the catch-up keeps it ready');
  await turn.wait(() => undefined);
  assert.equal(line.tickets.get(7)?.readyAt, 1_005_000, 'it keeps its first ready time');
});

test("a release lane holds a merge whose checks passed, a newer release too, until the release lands (T5132)", async () => {
  const line = fakeLine();
  const pids = new Set([7, 9]);
  line.tickets.set(9, releasing(9, 1_000_500, 1_000_500, 1_000_000 + 20 * 60_000));
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: alive(pids), clock: line.clock }, TIMES);
  for (let ms = 1000; ms < 5000; ms += 1000) line.clock.at(ms, () => line.tickets.set(9, releasing(9, 1_000_500, 1_000_000 + ms, 1_000_000 + 20 * 60_000)));
  line.clock.at(5000, () => {
    line.tickets.delete(9);
    pids.delete(9);
  });
  const said: string[] = [];
  await turn.wait(text => said.push(text));
  assert.deepEqual(said, [
    'checks passed; held by the release lane of T9 until it lands or fails, at most until 00:36:40 UTC',
    'the release lane of T9 ended, its release landed or failed: going on after 5 s',
  ]);
  assert.deepEqual(line.clock.slept, [1000, 1000, 1000, 1000, 1000]);
  assert.equal(turn.waited(), 1, 'the release that landed moved main by design (T4280)');
});

test('a release merge that fails frees the lane at once: its process ended, so its ticket is dead (T5132)', async () => {
  const line = fakeLine();
  const pids = new Set([7, 9]);
  line.tickets.set(9, releasing(9, 999_000, 1_000_000, 1_000_000 + 20 * 60_000));
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: alive(pids), clock: line.clock }, TIMES);
  // Its checks failed: the merge exits without removing its ticket.
  line.clock.at(2000, () => pids.delete(9));
  const said: string[] = [];
  await turn.wait(text => said.push(text));
  assert.equal(said.at(-1), 'the release lane of T9 ended, its release landed or failed: going on after 2 s');
  assert.equal(line.tickets.has(9), false, 'the dead ticket is removed');
});

test('the release lane holds at most its cap, then the merge goes on, saying so and not counting a landed wait (T5132)', async () => {
  const line = fakeLine();
  const until = 1_000_000 + 2500;
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: () => true, clock: line.clock }, TIMES);
  for (let ms = 0; ms <= 4000; ms += 500) line.clock.at(ms, () => line.tickets.set(9, releasing(9, 999_000, 1_000_000 + ms, until)));
  line.tickets.set(9, releasing(9, 999_000, 1_000_000, until));
  const said: string[] = [];
  await turn.wait(text => said.push(text));
  assert.deepEqual(line.clock.slept, [1000, 1000, 500], 'the last look falls on the cap');
  assert.deepEqual(said, [
    'checks passed; held by the release lane of T9 until it lands or fails, at most until 00:16:42 UTC',
    'the release lane of T9 reached its cap at 00:16:42 UTC: going on after 3 s',
  ]);
  assert.equal(turn.waited(), 0);
});

test('a lane opened while a merge waits on an older one holds it too, and the older merge is waited on after (T5132)', async () => {
  const line = fakeLine();
  const pids = new Set([5, 7, 9]);
  line.tickets.set(5, ready(5, 999_000, 1_000_000));
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: alive(pids), clock: line.clock }, TIMES);
  const until = 1_000_000 + 20 * 60_000;
  for (let ms = 1000; ms < 4000; ms += 1000) {
    line.clock.at(ms, () => {
      line.tickets.set(5, ready(5, 999_000, 1_000_000 + ms));
      line.tickets.set(9, releasing(9, 1_000_500, 1_000_000 + ms, until));
    });
  }
  line.clock.at(4000, () => {
    line.tickets.delete(9);
    pids.delete(9);
  });
  line.clock.at(5000, () => line.tickets.delete(5));
  const said: string[] = [];
  await turn.wait(text => said.push(text));
  assert.deepEqual(said, [
    'checks passed; waiting for 1 older merge(s) of this repo to land first: pid 5 started 00:16:39 UTC',
    'checks passed; held by the release lane of T9 until it lands or fails, at most until 00:36:40 UTC',
    'the release lane of T9 ended, its release landed or failed: going on after 3 s',
    'checks passed; waiting for 1 older merge(s) of this repo to land first: pid 5 started 00:16:39 UTC',
    'older merges landed or ended: going on after 1 s',
  ]);
  assert.equal(turn.waited(), 1, 'one wait, counted once');
});

test('the release merge opens its lane once, waits on no older merge, and a cap of 0 opens none (T5132)', async () => {
  const line = fakeLine();
  line.tickets.set(5, ready(5, 999_000, 1_000_000));
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: () => true, clock: line.clock }, TIMES);
  assert.equal(turn.openLane('T9', 0), false);
  assert.equal(line.tickets.get(7)?.lane, null, 'a cap of 0 opens no lane');
  assert.equal(turn.openLane('T9', 60_000), true);
  assert.deepEqual(line.tickets.get(7)?.lane, { task: 'T9', until: 1_060_000 });
  await line.clock.sleep(5000);
  assert.equal(turn.openLane('T9', 60_000), false);
  assert.deepEqual(line.tickets.get(7)?.lane, { task: 'T9', until: 1_060_000 }, 'a catch-up keeps the first lane');
  const said: string[] = [];
  await turn.wait(text => said.push(text));
  assert.deepEqual(said, [], 'the older merge is held by this lane: waiting on it would wait on itself');
  assert.deepEqual(line.clock.slept, [5000]);
  assert.equal(line.tickets.get(7)?.readyAt, 1_005_000);
});

test('a lane past its cap or on a dead ticket holds nobody (T5132)', async () => {
  const line = fakeLine();
  line.tickets.set(8, releasing(8, 999_000, 1_000_000, 1_000_000));
  line.tickets.set(9, releasing(9, 999_500, 1_000_000, 2_000_000));
  const turn = landingTurn({ store: line.store, pid: 7, pidAlive: alive(new Set([7, 8])), clock: line.clock }, TIMES);
  const said: string[] = [];
  await turn.wait(text => said.push(text));
  assert.deepEqual(said, []);
  assert.deepEqual(line.clock.slept, []);
});

test('parseTicket reads a written ticket, one written before readyAt as not ready, and refuses a torn or foreign one', () => {
  assert.deepEqual(parseTicket('{"pid":5,"startedAt":1,"beatAt":2,"readyAt":1}'), ready(5, 1, 2));
  assert.deepEqual(parseTicket('{"pid":5,"startedAt":1,"beatAt":2,"readyAt":null}'), inChecks(5, 1, 2));
  assert.deepEqual(parseTicket('{"pid":5,"startedAt":1,"beatAt":2}'), inChecks(5, 1, 2));
  assert.equal(parseTicket('{"pid":5,"startedAt":1,"beatAt":2,"readyAt":"1"}'), null);
  assert.equal(parseTicket('{"pid":5,"startedAt":1'), null);
  assert.equal(parseTicket('{"pid":"5","startedAt":1,"beatAt":2}'), null);
  assert.equal(parseTicket('[1,2]'), null);
});

test('parseTicket reads a release lane, a ticket written before lanes as none, and refuses a malformed lane (T5132)', () => {
  assert.deepEqual(parseTicket('{"pid":5,"startedAt":1,"beatAt":2,"readyAt":null,"lane":{"task":"T9","until":3}}'), releasing(5, 1, 2, 3));
  assert.deepEqual(parseTicket('{"pid":5,"startedAt":1,"beatAt":2,"readyAt":null,"lane":null}'), inChecks(5, 1, 2));
  assert.equal(parseTicket('{"pid":5,"startedAt":1,"beatAt":2,"lane":{"task":"T9"}}'), null);
  assert.equal(parseTicket('{"pid":5,"startedAt":1,"beatAt":2,"lane":{"task":9,"until":3}}'), null);
  assert.equal(parseTicket('{"pid":5,"startedAt":1,"beatAt":2,"lane":true}'), null);
});

test('the file store writes, lists and removes tickets, skipping files that are not one', () => {
  const root = mkdtempSync(join(tmpdir(), 'landing-'));
  try {
    const dir = join(root, 'ship-landing');
    const store = fileTicketStore(dir);
    assert.deepEqual(store.list(), [], 'no folder yet is an empty line');
    store.write(ready(5, 1, 2));
    store.write(ready(5, 1, 3));
    writeFileSync(join(dir, '6.json'), '{"pid":6');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    assert.deepEqual(store.list(), [ready(5, 1, 3)]);
    assert.deepEqual(readdirSync(dir).sort(), ['5.json', '6.json', 'notes.txt'], 'a write leaves no part file');
    store.remove(5);
    store.remove(5);
    assert.deepEqual(store.list(), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the line sits in the git common dir, resolved against the repo dir when git answers a relative one', () => {
  const asked: string[][] = [];
  const git = (...args: string[]): string => {
    asked.push(args);
    return '../main/.git';
  };
  assert.equal(landingDirOf('/repos/wt', git).replaceAll('\\', '/').replace(/^[A-Z]:/, ''), '/repos/main/.git/ship-landing');
  assert.deepEqual(asked, [['rev-parse', '--git-common-dir']]);
});

test('signalAlive answers for this process and for an id no process holds', () => {
  assert.equal(signalAlive(process.pid), true);
  assert.equal(signalAlive(2 ** 31 - 2), false);
});
