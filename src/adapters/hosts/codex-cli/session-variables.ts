import type { SessionVariables } from '../../../plugin-api/index.ts';

/**
 * Codex CLI sets it to the conversation's id in the environment its shell tool runs a command in, and drops it from
 * nothing it inherits: `populate_env` in `codex-rs/protocol/src/shell_environment.rs` (tag rust-v0.170.0, step 6).
 * Whether its hook commands get it too waits on a live run on a real Codex.
 */
export const AGENT_MARK = 'CODEX_THREAD_ID';

/**
 * What Codex CLI tells a run about its session by: its one mark. No other variable is named until a live run shows
 * which ones its hooks and tools really get.
 */
export const SESSION_VARIABLES: SessionVariables = { marks: [AGENT_MARK], identity: [] };
