import type { SessionIdentity, SessionPlace } from '../../../plugin-api/index.ts';

/** `CLAUDE_CODE_ENTRYPOINT` of Claude Code run in a terminal; `sdk-ts`, `sdk-cli` and the like are runs of its SDK. */
const TERMINAL_ENTRYPOINT = 'cli';
/** `CLAUDE_CODE_SESSION_KIND` of a background session: a daemon job, or a session sent to the background. */
const BACKGROUND_KIND = 'bg';

/**
 * Where a Claude Code session ran, by its entrypoint and session kind: any entrypoint but the terminal's is elsewhere,
 * whatever its kind; a background kind is a background job; the terminal's entrypoint alone is a tab. With neither
 * told it says nothing.
 */
export function sessionPlaceOf(told: Pick<SessionIdentity, 'startedAs' | 'sessionKind'>): SessionPlace | undefined {
  if (told.startedAs !== undefined && told.startedAs !== TERMINAL_ENTRYPOINT) {
    return 'elsewhere';
  }
  if (told.sessionKind === BACKGROUND_KIND) {
    return 'background';
  }
  return told.startedAs === undefined ? undefined : 'tab';
}
