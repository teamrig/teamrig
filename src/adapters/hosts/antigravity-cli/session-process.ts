import type { RunningProgram } from '../../../plugin-api/index.ts';

/**
 * agy's program by its file name only. teamrig ends a recorded session's process by this check (restart, idle close,
 * close), so it matches exactly and no loose substring: a process id the system gave another program since must not
 * pass (security condition C1 of T4891). agy's docs name no runtime wrapper, so no runtime's script passes.
 */
const AGY_PROGRAM = /^agy(\.exe)?$/i;

/** Whether a running process is Antigravity CLI's own program running a session. */
export function isAntigravitySessionProcess(process: RunningProgram): boolean {
  return AGY_PROGRAM.test(process.name);
}
