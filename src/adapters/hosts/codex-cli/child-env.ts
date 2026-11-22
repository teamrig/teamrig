import type { ChildEnvironment } from '../../../plugin-api/index.ts';
import { AGENT_MARK } from './session-variables.ts';

/**
 * Codex CLI sets it to the id of the tool call a command runs for, and resets it on each call
 * (`set_tool_call_id_env_var` in `codex-rs/protocol/src/shell_environment.rs`, tag rust-v0.170.0).
 */
const TOOL_CALL_ID = 'CODEX_TOOL_CALL_ID';

/**
 * Variables a Codex session sets for what its shell tool runs. A session or a step started from inside one must not
 * inherit them: it would carry its starter's conversation and tool call as its own. Codex already drops its own
 * launch secrets from what its tools run (`NON_INHERITABLE_ENV_VARS`, same file), so none of them reaches a child.
 */
const SESSION: readonly string[] = [AGENT_MARK, TOOL_CALL_ID];

/** A parked step keeps the conversation's id, so a nested `teamrig` still finds its parker; an id is no secret. */
const PARKED: readonly string[] = [AGENT_MARK];

/**
 * Codex's own login by API key, by the name its login help pipes it from (`printenv OPENAI_API_KEY | codex login
 * --with-api-key`, Codex 0.170.0) and `auth.json` stores it under: a session is Codex, so it keeps it; no other
 * program teamrig starts gets it.
 */
const LOGIN: readonly string[] = ['OPENAI_API_KEY'];

/** What a program started from a Codex session may inherit of the session's variables. */
export const CHILD_ENVIRONMENT: ChildEnvironment = { session: SESSION, parked: PARKED, login: LOGIN };
