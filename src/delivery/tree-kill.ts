import { execFile } from 'node:child_process';
import { lineShellOf, powerShellSpec, type LineShellSpec, type ScriptRun, type ScriptShell } from './line-shell.ts';
import { treeOf, wholeNumberTriples, type ProcessLink } from './processes.ts';

/**
 * A process this one started and still holds, as Node's ChildProcess: no pid when it never started, and a kill sent
 * through its own handle, which names that process alone even after Windows hands its id to another.
 */
export interface HeldProcess {
  readonly pid?: number | undefined;
  kill(signal: NodeJS.Signals): boolean;
}

/**
 * Ends a held process and every process it started; settles once they are ended or the kill gave up, and never
 * rejects. A process that never started has nothing to end.
 */
export type TreeKill = (held: HeldProcess) => Promise<void>;

/** A kill begun on a run: why (its time limit, or its `stop` aborting) and the kill, settled once the tree is ended. */
export interface RunKill {
  readonly why: 'timedOut' | 'stopped';
  readonly done: Promise<void>;
}

/** One process as the Windows sweep lists it: its id, its parent's and when it started, in ms since the epoch. */
export interface StartedProcess extends ProcessLink {
  readonly startedMs: number;
}

/** What the Windows sweep needs from the host. */
export interface SweepHost {
  /** Every process now; undefined when they cannot be listed. */
  list(): Promise<readonly StartedProcess[] | undefined>;
  /**
   * Force-ends exactly these processes, none they started, each only while its id still names the process the list saw
   * (the same start); settles once the kill is done.
   */
  kill(targets: readonly StartedProcess[]): Promise<void>;
  now(): number;
}

/**
 * How a sweep ended: `swept` when it listed the root and ended its tree, `gone` when the first list no longer had the
 * root, `unlisted` when the host could not be listed, so nothing was ended.
 */
export type SweepOutcome = 'swept' | 'gone' | 'unlisted';

/** The most list-and-kill rounds a sweep makes: each round ends one more generation, started before its parent ended. */
export const SWEEP_ROUNDS = 5;

/** How often a sweep tries its first list: a list can time out on a loaded host, and without one nothing is ended. */
export const LIST_TRIES = 2;

/** Bounds a process list or a kill, so a hung one cannot hold a timed-out step forever. */
const HOST_CALL_TIMEOUT_MS = 30_000;

/** Bytes a process list may print: a host with thousands of processes stays far under it. */
const LIST_MAX_BUFFER = 16 * 2 ** 20;

/**
 * The processes the last kill missed: a member it did not end (same id, same start), and the tree of each process
 * a member started (its parent is a member) before the kill ended. A process whose parent id is now held by a
 * different live process, that started after the kill ended, or that started before the member it names as its
 * parent, is a stranger behind a reused id and is left alone. The last is a detached queue waiter (T2785): its
 * launcher ends at once, Windows hands that id to a later process of some tab, and a sweep of that tab ended the
 * waiter as the member's orphan.
 */
export function stragglersOf(rows: readonly StartedProcess[], members: ReadonlyMap<number, number>, killedAtMs: number): StartedProcess[] {
  const liveStart = new Map(rows.map((row) => [row.pid, row.startedMs]));
  const parentIsMember = (row: StartedProcess): boolean => {
    const memberStart = members.get(row.parent);
    const parentStart = liveStart.get(row.parent);
    return memberStart !== undefined && memberStart <= row.startedMs && (parentStart === undefined || parentStart === memberStart);
  };
  const seeds = rows.filter((row) => (members.has(row.pid) ? members.get(row.pid) === row.startedMs : parentIsMember(row) && row.startedMs <= killedAtMs));
  const found = new Map<number, StartedProcess>();
  for (const seed of seeds) {
    for (const row of treeOf(seed.pid, rows)) {
      found.set(row.pid, row);
    }
  }
  return [...found.values()];
}

/** The host's processes from the first list that works, of at most `LIST_TRIES`; undefined when none did. */
async function firstList(host: SweepHost): Promise<readonly StartedProcess[] | undefined> {
  for (let tries = 0; tries < LIST_TRIES; tries += 1) {
    const rows = await host.list();
    if (rows !== undefined) {
      return rows;
    }
  }
  return undefined;
}

/**
 * Ends the tree of `root` on Windows. The sweep lists the host, ends exactly the tree's listed processes, then lists
 * again and ends the stragglers, until a list finds none or `rounds` run out. It never runs `taskkill /T`: that walk
 * links a process to any older one that held its parent's id, with no start check, so a root that reused the id of a
 * long-ended process ends every program that one started; a Windows Terminal started so lost every tab (T2336). It
 * also misses a process started during the walk. Ending only listed processes, every ended process is a member, so an
 * orphan always has a member parent and the next list finds it. With no first list it ends nothing (`unlisted`): the
 * caller that holds the root's process can end that alone. When a later list fails it stops: killing the last ids
 * again without a fresh list could end a stranger that took one of them.
 */
export async function sweepTree(root: number, host: SweepHost, rounds: number = SWEEP_ROUNDS): Promise<SweepOutcome> {
  const first = await firstList(host);
  return first === undefined ? 'unlisted' : sweepFrom(treeOf(root, first), host, rounds);
}

/**
 * Ends on Windows what `root` started and left running once it exited by itself (#1492): each listed process whose
 * parent id is root's and that started while root ran (from `startedMs`, at or before root's start, to `exitedMs`), with
 * its tree, then the stragglers list after list as sweepTree does. A process an earlier or a later holder of root's id
 * started falls outside that time and is left alone. `exitedMs` is read after the real exit, and Windows hands a freed
 * id on within ms, so a listed process with root's id is a later holder: only what started before it is root's. Windows
 * keeps no link past an ended process, so a process whose own parent ended before the list is not found.
 */
export async function sweepOrphans(root: number, startedMs: number, exitedMs: number, host: SweepHost, rounds: number = SWEEP_ROUNDS): Promise<SweepOutcome> {
  const first = await firstList(host);
  if (first === undefined) {
    return 'unlisted';
  }
  const laterHolder = first.find((row) => row.pid === root);
  const endMs = laterHolder === undefined ? exitedMs : Math.min(exitedMs, laterHolder.startedMs - 1);
  const orphans = first.filter((row) => row.parent === root && row.pid !== root && row.startedMs >= startedMs && row.startedMs <= endMs);
  const trees = new Map(orphans.flatMap((orphan) => treeOf(orphan.pid, first)).map((row) => [row.pid, row]));
  return sweepFrom([...trees.values()], host, rounds);
}

/** Ends `targets`, then lists again and ends the stragglers, until a list finds none or `rounds` run out. */
async function sweepFrom(firstTargets: readonly StartedProcess[], host: SweepHost, rounds: number): Promise<SweepOutcome> {
  if (firstTargets.length === 0) {
    return 'gone';
  }
  const members = new Map<number, number>();
  let targets = firstTargets;
  for (let round = 0; round < rounds && targets.length > 0; round += 1) {
    for (const target of targets) {
      members.set(target.pid, target.startedMs);
    }
    await host.kill(targets);
    const killedAtMs = host.now();
    const rows = await host.list();
    if (rows === undefined) {
      return 'swept';
    }
    targets = stragglersOf(rows, members, killedAtMs);
  }
  return 'swept';
}

/** Rows of `<pid>,<parent>,<startedMs>` lines; a line that is not three whole numbers is left out. */
export function parseStartedProcesses(text: string): StartedProcess[] {
  return wholeNumberTriples(text).map(([pid, parent, startedMs]) => ({ pid, parent, startedMs }));
}

/** Win32_Process with each start as Unix ms; a process with no start (the idle and system ones) prints 0. */
const LIST_SCRIPT =
  'Get-CimInstance Win32_Process | ForEach-Object { ' +
  "'{0},{1},{2}' -f $_.ProcessId,$_.ParentProcessId,$(if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }) }";

/** PowerShell started for one script, which it is given as its command. */
export const runPowerShellOnce: ScriptRun = (script) =>
  new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, maxBuffer: LIST_MAX_BUFFER, timeout: HOST_CALL_TIMEOUT_MS },
      (error, stdout) => resolve(error === null ? stdout : undefined),
    );
  });

/**
 * Ends each target only while its id still names the process the list saw. Windows hands a freed id to the next new
 * process within milliseconds and a list takes about a second, so a listed process that ended by itself meanwhile (a
 * console host whose shell was just killed) can be another program by the kill, which `taskkill /PID` would end
 * (T1562). The script first opens a handle to each target, which holds its id, then reads each start through that
 * handle and ends, through it, only a held process whose start is the listed one; a process whose start cannot be read
 * is never ended. The handle's start is the kernel's creation time, the one Win32_Process's CreationDate shows, so it
 * matches the list to the millisecond, and the kill needs no CIM query of its own: each query loads CimCmdlets and
 * takes about 0.4 s idle, seconds under load, and a sweep kills at least once (T5031). A target that ended or cannot
 * be opened is skipped; the next list finds any member it missed.
 */
export function killScript(targets: readonly StartedProcess[]): string {
  const wanted = targets.map((target) => `${target.pid} = ${target.startedMs}`).join('; ');
  return (
    `$want = @{ ${wanted} }; $held = @{}; ` +
    'foreach ($id in @($want.Keys)) { try { $p = Get-Process -Id $id -ErrorAction Stop; $null = $p.Handle; $held[$id] = $p } catch {} }; ' +
    'foreach ($id in @($held.Keys)) { try { ' +
    'if (([DateTimeOffset]$held[$id].StartTime).ToUnixTimeMilliseconds() -eq $want[$id]) { $held[$id].Kill() } } catch {} }'
  );
}

/**
 * The Windows host over `run`, a PowerShell script runner: it lists the processes and ends listed ones by id and start
 * (`killScript`). A failed call ends nothing.
 */
export function windowsSweepHostOf(run: ScriptRun, now: () => number = () => Date.now()): SweepHost {
  return {
    list: async () => {
      const printed = await run(LIST_SCRIPT);
      return printed === undefined ? undefined : parseStartedProcesses(printed);
    },
    kill: async (targets) => {
      if (targets.length > 0) {
        await run(killScript(targets));
      }
    },
    now,
  };
}

/** The real Windows host, starting PowerShell for each call. */
export const windowsSweepHost: SweepHost = windowsSweepHostOf(runPowerShellOnce);

/** A host opened for one sweep; `close` frees what it holds. */
export interface SweepSession {
  readonly host: SweepHost;
  close(): void;
}

/** Opens the host for one sweep. */
export type SweepOpener = () => SweepSession;

/** Starts a shell kept open across scripts, as `lineShellOf` does. */
export type ShellOpener = (spec: LineShellSpec) => ScriptShell;

/**
 * The Windows host over one PowerShell kept open for the sweep, from `openShell`. A sweep lists, kills and lists again
 * at least, and a fresh PowerShell costs about 0.45 s to launch and 0.6 s more to load the CIM module before its first
 * list; one shell pays that once, and its later lists take about 0.4 s (T5031). A call that hangs ends that shell, and
 * the next call starts another. Closing the session closes the shell.
 */
export function windowsSweepOpenerOf(openShell: ShellOpener): SweepOpener {
  return () => {
    const shell = openShell(powerShellSpec(HOST_CALL_TIMEOUT_MS, LIST_MAX_BUFFER));
    return { host: windowsSweepHostOf(shell.run), close: shell.close };
  };
}

/** The real Windows host over one PowerShell kept open for each sweep. */
export const openWindowsSweep: SweepOpener = windowsSweepOpenerOf(lineShellOf);

/**
 * On Windows the sweep ends the tree: killing only the shell would leave the command it started running. When the host
 * cannot be listed, the held process alone is ended through its handle: what it started runs on, but no id walk can
 * reach a stranger. On POSIX the step runs as its own process group, and the group is killed; an orphan stays in its
 * group.
 */
export function nodeTreeKill(platform: NodeJS.Platform, open: SweepOpener = openWindowsSweep): TreeKill {
  if (platform === 'win32') {
    return async (held) => {
      if (held.pid === undefined) {
        return;
      }
      const session = open();
      try {
        if ((await sweepTree(held.pid, session.host)) === 'unlisted') {
          held.kill('SIGKILL');
        }
      } finally {
        session.close();
      }
    };
  }
  return (held) => {
    if (held.pid !== undefined) {
      try {
        process.kill(-held.pid, 'SIGKILL');
      } catch {
        // The group ended on its own between the timer and the kill.
      }
    }
    return Promise.resolve();
  };
}

/**
 * Ends what a process that exited by itself left running (#1492). `startedMs` is a time at or before the process
 * started and `exitedMs` when it was seen to exit. Settles once the end is done, and never rejects.
 */
export type LeftoverKill = (pid: number, startedMs: number, exitedMs: number) => Promise<void>;

/**
 * On POSIX the step ran as its own process group, so the group is killed, as at its time limit; with the group
 * leader gone its id names the group until the last member ends. On Windows the orphans are swept (sweepOrphans).
 */
export function nodeLeftoverKill(platform: NodeJS.Platform, open: SweepOpener = openWindowsSweep): LeftoverKill {
  if (platform === 'win32') {
    return async (pid, startedMs, exitedMs) => {
      const session = open();
      try {
        await sweepOrphans(pid, startedMs, exitedMs, session.host);
      } catch {
        // A sweep that fails ends nothing more; the step's own end stands.
      } finally {
        session.close();
      }
    };
  }
  return (pid) => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // No process of the group runs on.
    }
    return Promise.resolve();
  };
}
