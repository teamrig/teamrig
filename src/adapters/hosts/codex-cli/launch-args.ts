import type { SessionStart } from '../../../plugin-api/index.ts';

/** Codex CLI's program as npm installs it on PATH (`@openai/codex`'s `bin`), the native binary named the same. */
export const PROGRAM = 'codex';

/**
 * Turns off Codex's interactive shells on every start. With them on (the default in Codex 0.170.0), `exec_command`
 * opens a shell with `tty: true` and `write_stdin` then sends it lines no PreToolUse hook sees, so teamrig's shell guards
 * would judge only the bare shell. Off, `exec_command` refuses a tty and `write_stdin` into a shell without one fails
 * (T5270 F2). A `-c` override beats both the root `[features]` of the person's config.toml, where `setup hooks --host
 * codex` writes the same key for sessions started outside teamrig, and the features of a profile chosen with
 * `--profile`, which Codex applies over the root ones: Codex 0.171 drops the `tty` parameter from `exec_command` in
 * `codex -p <name> -c features.unified_exec_tty=false debug prompt-input` while `<name>.config.toml` turns it on (T5361).
 */
export const NO_TTY_SHELLS: readonly string[] = ['-c', 'features.unified_exec_tty=false'];

/** The flag with its value, or nothing when the value is left to Codex CLI. */
function flag(name: string, value: string | undefined): readonly string[] {
  return value === undefined ? [] : [name, value];
}

/** A start whose parts Codex CLI would read as something else, refused before the program runs. */
export class CodexLaunchRefusedError extends Error {
  override readonly name = 'CodexLaunchRefusedError';
}

/**
 * The resume subcommand with its session id. The id is a positional argument, so one starting with `-` would read as
 * a flag of Codex's; a real Codex session id never does, so such an id is refused rather than passed.
 */
function resumeArgs(resume: string | undefined): readonly string[] {
  if (resume === undefined) {
    return [];
  }
  if (resume.startsWith('-')) {
    throw new CodexLaunchRefusedError(`the Codex CLI session id to resume, ${JSON.stringify(resume)}, starts with "-" and would read as a flag; give the id Codex printed`);
  }
  return ['resume', resume];
}

/**
 * The `codex` arguments that start a session as `start` says. A resume is Codex's `resume <SESSION_ID>` subcommand
 * (Codex 0.170.0, `cli_main.rs`), which takes the same session flags after it; the model is `--model`, the effort the
 * `model_reasoning_effort` config key through `-c`; the first prompt goes last, after `--`, so a prompt starting with
 * `-` stays the prompt and is never read as a flag.
 *
 * Codex has no flag for a session's shown name or for a settings file loaded over the person's own, so `name` and
 * `settingsFile` pass nothing: the declaration keeps `sessions.open` unsupported until a live run proves a start.
 */
export function launchArgs(start: SessionStart): readonly string[] {
  return [
    ...resumeArgs(start.resume),
    ...NO_TTY_SHELLS,
    ...flag('--model', start.model),
    ...(start.effort === undefined ? [] : ['-c', `model_reasoning_effort=${start.effort}`]),
    ...(start.prompt === undefined ? [] : ['--', start.prompt]),
  ];
}
