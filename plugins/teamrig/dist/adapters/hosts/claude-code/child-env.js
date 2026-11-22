import { AGENT_MARK, ENTRYPOINT, PROJECT_DIR, SESSION_ID } from "./session-variables.js";
/**
 * Variables a running Claude Code session sets for its own tools. A terminal started from inside one (Konsole and
 * x-terminal-emulator inherit the starting process's environment) would pass them on, and the new session would look
 * nested inside the old one and could reach its messaging socket.
 */
const SESSION = [
    AGENT_MARK,
    SESSION_ID,
    'CLAUDE_CODE_CHILD_SESSION',
    ENTRYPOINT,
    'CLAUDE_CODE_EXECPATH',
    'CLAUDE_CODE_MESSAGING_SOCKET',
    'CLAUDE_CODE_MESSAGING_TOKEN',
    'CLAUDE_CODE_SESSION_ATTENDED',
    'CLAUDE_PID',
    PROJECT_DIR,
];
/**
 * The session variables a parked step keeps on disk, so a nested `teamrig` in it still resolves its parker's tab:
 * none is a secret. The rest of `SESSION` stays off disk; the messaging token is a secret, and the step simply goes
 * without it and the socket.
 */
const PARKED = [AGENT_MARK, SESSION_ID, ENTRYPOINT, PROJECT_DIR];
/** Claude Code's own login: a session is Claude Code, so it keeps these; no other program teamrig starts gets them. */
const LOGIN = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];
/** What a program started from a Claude Code session may inherit of the session's variables. */
export const CHILD_ENVIRONMENT = { session: SESSION, parked: PARKED, login: LOGIN };
