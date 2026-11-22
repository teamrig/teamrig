import { runsSession, sessionProcessOf } from '../open/session-processes.ts';
import { sessionProcessCheckOf } from './host.ts';
import type { CliRuntime } from './runtime.ts';

/** What telling a session's process takes of a run: the hosts that know their own programs, and the machine's processes. */
export type SessionProcessRuntime = Pick<CliRuntime, 'host' | 'shippedHosts' | 'env' | 'platform' | 'sessionProcesses'>;

/**
 * Whether `pid` still runs a session, in the program of a host teamrig ships with or of the running host
 * (`sessionProcessCheckOf`): a pid the system gave another program since does not count, nor one that is gone.
 */
export function runsHostSession(runtime: SessionProcessRuntime, pid: number | undefined): Promise<boolean> {
  return runsSession(runtime.sessionProcesses, pid, sessionProcessCheckOf(runtime));
}

/**
 * The session this run works under: the host program that started it, itself or through a shell between
 * (`sessionProcessOf`), as a hook is started by its session. The program is one of a host teamrig ships with or of
 * the running host; undefined when none is that near, or the system would not list its processes.
 */
export function hostSessionAbove(runtime: SessionProcessRuntime): Promise<number | undefined> {
  return sessionProcessOf(runtime.sessionProcesses, runtime.sessionProcesses.parentPid, sessionProcessCheckOf(runtime));
}
