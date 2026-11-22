import type { SessionStart } from '../../../plugin-api/index.ts';

/** Codex CLI's program as npm installs it on PATH (`@openai/codex`'s `bin`), the native binary named the same. */
export const PROGRAM = 'codex';

/** The flag with its value, or nothing when the value is left to Codex CLI. */
function flag(name: string, value: string | undefined): readonly string[] {
  return value === undefined ? [] : [name, value];
}

/**
 * The `codex` arguments that start a session as `start` says. A resume is Codex's `resume <SESSION_ID>` subcommand
 * (Codex 0.170.0, `cli_main.rs`), which takes the same session flags after it; the model is `--model`, the effort the
 * `model_reasoning_effort` config key through `-c`; the first prompt goes last, as the one argument that is no flag.
 *
 * Codex has no flag for a session's shown name or for a settings file loaded over the person's own, so `name` and
 * `settingsFile` pass nothing: the declaration keeps `sessions.open` unsupported until a live run proves a start.
 */
export function launchArgs(start: SessionStart): readonly string[] {
  return [
    ...(start.resume === undefined ? [] : ['resume', start.resume]),
    ...flag('--model', start.model),
    ...(start.effort === undefined ? [] : ['-c', `model_reasoning_effort=${start.effort}`]),
    ...(start.prompt === undefined ? [] : [start.prompt]),
  ];
}
