import type { RunningProgram, SessionIdentity, SessionPlace } from '../../../plugin-api/index.ts';

/** A command line's words, as the system shows it (spaces) or as it was given (NULs). */
function argsOf(commandLine: string): readonly string[] {
  return commandLine.split(/[\s\0]+/).filter((arg) => arg !== '');
}

/**
 * Whether `commandLine` is Codex CLI's `fork <SESSION_ID>` of session `session` (Codex 0.170.0, `cli_main.rs`): a new
 * session from that one's conversation. `fork --last` names no session, so it is no fork of a known one.
 */
export function isForkOf(commandLine: string, session: string): boolean {
  const args = argsOf(commandLine);
  return args.some((arg, i) => arg === 'fork' && args[i + 1] === session);
}

/** Codex CLI runs no background job host teamrig can read a session from, so no lineage names one. */
export function backgroundJobSession(_lineage: readonly RunningProgram[]): string | undefined {
  return undefined;
}

/** Codex CLI tells no start word or session kind in the environment (see `identity`), so it says nothing of a place. */
export function sessionPlaceOf(_told: Pick<SessionIdentity, 'startedAs' | 'sessionKind'>): SessionPlace | undefined {
  return undefined;
}
