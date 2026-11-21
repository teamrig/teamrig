import type { SessionStart } from '../../../plugin-api/index.ts';

/** Claude Code's program as its installers name it on every platform: the native binary and the npm launcher alike. */
export const PROGRAM = 'claude';

/** The flag with its value, or nothing when the value is left to Claude Code. */
function flag(name: string, value: string | undefined): readonly string[] {
  return value === undefined ? [] : [name, value];
}

/**
 * The `claude` arguments that start a session as `start` says: each part that is set as its flag, and the first
 * prompt last, as the one argument that is no flag. A part left out passes no flag, so Claude Code keeps its own.
 */
export function launchArgs(start: SessionStart): readonly string[] {
  return [
    ...flag('--model', start.model),
    ...flag('--effort', start.effort),
    ...flag('--settings', start.settingsFile),
    ...flag('--resume', start.resume),
    ...flag('--name', start.name),
    ...(start.prompt === undefined ? [] : [start.prompt]),
  ];
}
