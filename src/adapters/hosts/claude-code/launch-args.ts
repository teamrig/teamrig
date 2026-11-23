import type { SessionStart } from '../../../plugin-api/index.ts';

/** Claude Code's program as its installers name it on every platform: the native binary and the npm launcher alike. */
export const PROGRAM = 'claude';

/** The file Claude Code reads a plugin folder by. */
export const PLUGIN_MANIFEST = '.claude-plugin/plugin.json';

/** The flag with its value, or nothing when the value is left to Claude Code. */
function flag(name: string, value: string | undefined): readonly string[] {
  return value === undefined ? [] : [name, value];
}

/** A start whose parts Claude Code would read as something else, refused before the program runs. */
export class ClaudeLaunchRefusedError extends Error {
  override readonly name = 'ClaudeLaunchRefusedError';
}

/**
 * `--resume` with the session id. An id starting with `-` could read as a flag of Claude Code's rather than the
 * value; a real Claude Code session id never does, so such an id is refused rather than passed.
 */
function resumeArgs(resume: string | undefined): readonly string[] {
  if (resume !== undefined && resume.startsWith('-')) {
    throw new ClaudeLaunchRefusedError(`the Claude Code session id to resume, ${JSON.stringify(resume)}, starts with "-" and would read as a flag; give the id Claude Code printed`);
  }
  return flag('--resume', resume);
}

/**
 * The `claude` arguments that start a session as `start` says: a `--plugin-dir` for each plugin folder first, each
 * part that is set as its flag, and the first prompt last, after `--`, so a prompt starting with `-` stays the prompt and is never read as a flag. A part left
 * out passes no flag, so Claude Code keeps its own.
 */
export function launchArgs(start: SessionStart): readonly string[] {
  return [
    ...start.pluginDirs.flatMap((dir) => ['--plugin-dir', dir]),
    ...flag('--model', start.model),
    ...flag('--effort', start.effort),
    ...flag('--settings', start.settingsFile),
    ...resumeArgs(start.resume),
    ...flag('--name', start.name),
    ...(start.prompt === undefined ? [] : ['--', start.prompt]),
  ];
}
