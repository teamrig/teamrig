import type { SessionStart } from '../../../plugin-api/index.ts';

/** Antigravity CLI's program as its install puts it on PATH. */
export const PROGRAM = 'agy';

/** A start whose parts Antigravity CLI would read as something else, refused before the program runs. */
export class AntigravityLaunchRefusedError extends Error {
  override readonly name = 'AntigravityLaunchRefusedError';
}

/**
 * The flag with its value, or nothing when the value is left to agy. agy's docs show no `--` marker that ends its
 * flags, so a value starting with `-` could read as a flag of its own: such a value is refused rather than passed.
 */
function flag(name: string, what: string, value: string | undefined): readonly string[] {
  if (value === undefined) {
    return [];
  }
  if (value.startsWith('-')) {
    throw new AntigravityLaunchRefusedError(`the Antigravity CLI ${what}, ${JSON.stringify(value)}, starts with "-" and would read as a flag of agy's`);
  }
  return [name, value];
}

/**
 * The `agy` arguments that start a session as `start` says (agy CLI reference, read 2026-11-23): `--conversation <id>`
 * resumes a conversation, `--model <slug>` and `--effort <level>` pick the model and effort, and
 * `-i <prompt>` (`--prompt-interactive`) runs a first prompt and keeps the session interactive.
 *
 * agy has no flag for a session's shown name or for a settings file loaded over the person's own, so `name` and
 * `settingsFile` pass nothing: the declaration keeps `sessions.open` partial until a live run proves a start.
 */
export function launchArgs(start: SessionStart): readonly string[] {
  return [
    ...flag('--conversation', 'conversation id to resume', start.resume),
    ...flag('--model', 'model', start.model),
    ...flag('--effort', 'effort', start.effort),
    ...flag('-i', 'first prompt', start.prompt),
  ];
}
