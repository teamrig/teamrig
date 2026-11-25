import type { RunningProgram, SessionIdentity, SessionPlace } from '../../../plugin-api/index.ts';

/** agy forks a conversation only with its `/fork` slash command inside a session, never by a command line. */
export function isForkOf(_commandLine: string, _session: string): boolean {
  return false;
}

/** agy runs no background job host teamrig can read a session from, so no lineage names one. */
export function backgroundJobSession(_lineage: readonly RunningProgram[]): string | undefined {
  return undefined;
}

/** agy tells no start word or session kind in the environment (see `identity`), so it says nothing of a place. */
export function sessionPlaceOf(_told: Pick<SessionIdentity, 'startedAs' | 'sessionKind'>): SessionPlace | undefined {
  return undefined;
}
