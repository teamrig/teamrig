import type { ChildEnvironment } from '../../../plugin-api/index.ts';

/** The conversation's id agy sets for its hooks and for what `run_command` runs: the session's mark. */
export const CONVERSATION_ID = 'ANTIGRAVITY_CONVERSATION_ID';

/**
 * Every variable agy 1.5.8 set for what `run_command` ran in a clean-environment live run (#2142's record, names only).
 * A session or a step started from inside one must not inherit them: it would carry its starter's conversation, and
 * the language server's address and CSRF token reach that session's own server.
 */
const SESSION: readonly string[] = [
  'ANTIGRAVITY_AGENT',
  'ANTIGRAVITY_AGENTAPI_EXE',
  'ANTIGRAVITY_APP_DATA_DIR',
  CONVERSATION_ID,
  'ANTIGRAVITY_CSRF_TOKEN',
  'ANTIGRAVITY_LS_ADDRESS',
  'ANTIGRAVITY_LS_VERSION',
  'ANTIGRAVITY_PROJECT_ID',
  'ANTIGRAVITY_SOURCE_METADATA',
  'ANTIGRAVITY_TRAJECTORY_ID',
];

/** A parked step keeps the conversation's id, so a nested `teamrig` still finds its parker; an id is no secret. */
const PARKED: readonly string[] = [CONVERSATION_ID];

/** agy keeps its Google sign-in in the OS keyring and reads no login variable, so a session keeps none. */
const LOGIN: readonly string[] = [];

/** What a program started from an agy session may inherit of the session's variables. */
export const CHILD_ENVIRONMENT: ChildEnvironment = { session: SESSION, parked: PARKED, login: LOGIN };
