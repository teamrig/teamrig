import type { Files } from '../core/files.ts';
import { errorMessage } from '../core/guards.ts';
import { resolveKitHome } from '../core/home.ts';
import type { Sleep } from '../core/lock.ts';
import { compareVersions, parseVersion } from '../core/release-version.ts';
import { KIT_VERSION } from '../core/version.ts';
import { treeOf } from '../delivery/processes.ts';
import { readKitCurrent } from '../kit/kit-versions.ts';
import type { ProcessInfo, SessionProcesses } from '../open/session-processes.ts';
import type { CliRuntime } from './runtime.ts';

/**
 * The guard `teamrig ui` runs beside its UI (T5813): a UI kept running after a newer teamrig installed, or after the
 * terminal it ran in closed, ran on for days (11-27: a 0.504.0 UI, its terminal gone since 11-22, 2 124 s of CPU).
 * Each look, the guard ends the UI it started once `<kit home>/current` names a newer version, or once a process
 * this one ran under has ended.
 */

/** How often the guard looks: a look reads one small file and checks a few pids. */
export const UI_GUARD_EVERY_MS = 15_000;

/** Why the guard ended the UI. */
export type UiEndReason =
  /** `<kit home>/current` names `current`, a version newer than this one. */
  | { readonly kind: 'superseded'; readonly current: string }
  /** A process this one ran under (its terminal, its shell) has ended. */
  | { readonly kind: 'terminal-gone'; readonly gone: ProcessInfo };

/** The line `teamrig ui` ends on after its guard ended the UI. */
export function uiEndText(reason: UiEndReason): string {
  return reason.kind === 'superseded'
    ? `ENDED the UI: teamrig ${reason.current} is installed, and this UI ran ${KIT_VERSION}; run teamrig ui again`
    : `ENDED the UI: ${reason.gone.name} ${reason.gone.pid}, which it ran under, has ended`;
}

/** The version `current` names when it is newer than `running`; undefined when none is named, or it is not newer. */
export async function newerCurrent(files: Pick<Files, 'read'>, kitHome: string, running: string): Promise<string | undefined> {
  const current = (await readKitCurrent(files, kitHome))?.version;
  const named = current === undefined ? undefined : parseVersion(current);
  const own = parseVersion(running);
  return current !== undefined && named !== undefined && own !== undefined && compareVersions(named, own) > 0 ? current : undefined;
}

export interface UiGuardPorts {
  readonly files: Pick<Files, 'read'>;
  readonly kitHome: string;
  /** This teamrig's own version. */
  readonly running: string;
  /** This process: the UI's starter. */
  readonly ownPid: number;
  readonly platform: NodeJS.Platform;
  readonly processes: Pick<SessionProcesses, 'alive' | 'lineage' | 'list' | 'end'>;
  /** A wait that never holds the process open, so the guard never keeps an ended UI's process up. */
  readonly sleep: Sleep;
}

/**
 * The guard: `reason` is set once it began to end the UI, `problem` is its last look's failure (kept, not printed,
 * as the UI owns the terminal), and `stop` ends its loop at its next wake.
 */
export interface UiGuard {
  reason(): UiEndReason | undefined;
  problem(): string | undefined;
  stop(): void;
}

/**
 * Ends every process this one started, so the UI's `run` returns. On Windows ending a child ends its tree (the
 * start-checked sweep, session-processes.ts); elsewhere each pid of the tree is ended, the children first in the
 * listing's order. True once each end went or found the process gone.
 */
async function endOwnTree(ports: UiGuardPorts, warn: (line: string) => void): Promise<boolean> {
  const listed = await ports.processes.list();
  if (listed === undefined) {
    warn('WARN the UI guard could not list the processes to end the UI; the next look tries again');
    return false;
  }
  const rows = listed.map(({ info, startedMs }) =>
    startedMs === undefined ? { pid: info.pid, parent: info.parentPid } : { pid: info.pid, parent: info.parentPid, startedMs },
  );
  const tree = treeOf(ports.ownPid, rows).filter((row) => row.pid !== ports.ownPid);
  const pids = ports.platform === 'win32' ? tree.filter((row) => row.parent === ports.ownPid).map((row) => row.pid) : tree.map((row) => row.pid);
  let ended = true;
  for (const pid of pids) {
    const outcome = await ports.processes.end(pid, 'force');
    if (outcome.kind === 'failed') {
      warn(`WARN the UI guard could not end ${pid}: ${outcome.error}; the next look tries again`);
      ended = false;
    }
  }
  return ended;
}

/**
 * Starts the guard. Its first look, one wait after the start, takes the processes this one runs under; a launcher
 * that exits once it started this one (a terminal's `wt.exe`) has ended by then, so it is not taken for the terminal.
 * From then on any of them ending, or a newer `current`, ends the UI. A look that cannot list the processes leaves
 * the terminal unchecked until one can.
 */
export function startUiGuard(ports: UiGuardPorts, everyMs: number = UI_GUARD_EVERY_MS): UiGuard {
  let stopped = false;
  let reason: UiEndReason | undefined;
  let problem: string | undefined;
  const warn = (line: string): void => {
    problem = line;
  };
  let above: readonly ProcessInfo[] | undefined;
  const look = async (): Promise<UiEndReason | undefined> => {
    const current = await newerCurrent(ports.files, ports.kitHome, ports.running);
    if (current !== undefined) {
      return { kind: 'superseded', current };
    }
    if (above === undefined) {
      above = (await ports.processes.lineage(ports.ownPid))?.filter((info) => info.pid !== ports.ownPid);
      return undefined;
    }
    const gone = above.find((info) => !ports.processes.alive(info.pid));
    return gone === undefined ? undefined : { kind: 'terminal-gone', gone };
  };
  const loop = async (): Promise<void> => {
    while (!stopped) {
      await ports.sleep(everyMs);
      if (stopped) {
        break;
      }
      try {
        reason ??= await look();
        if (reason !== undefined && (await endOwnTree(ports, warn))) {
          return;
        }
      } catch (error) {
        warn(`WARN the UI guard's look failed: ${errorMessage(error)}; the next look tries again`);
      }
    }
  };
  void loop();
  return {
    reason: () => reason,
    problem: () => problem,
    stop: () => {
      stopped = true;
    },
  };
}

/** The guard as `teamrig ui` starts it, over the CLI's runtime. */
export function startCliUiGuard(runtime: CliRuntime): UiGuard {
  return startUiGuard({
    files: runtime.files,
    kitHome: resolveKitHome(runtime.env, runtime.userHome),
    running: KIT_VERSION,
    ownPid: runtime.pid,
    platform: runtime.platform,
    processes: runtime.sessionProcesses,
    sleep: runtime.idleSleep,
  });
}
