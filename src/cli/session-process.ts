import { runsSession } from '../open/session-processes.ts';
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
