import type { RunningProgram } from '../../../plugin-api/index.ts';

/**
 * Claude Code's own program, and nothing whose name only starts the same. Every Claude Code teamrig runs on
 * (`MIN_CLAUDE_CODE`, 2.1.139) is this native binary: npm's package names `bin/claude.exe` as its entry from 2.1.113,
 * and its Node.js fallback `cli-wrapper.cjs` only starts the binary as its child and waits, so Node.js never runs a
 * session itself.
 */
const CLAUDE_PROGRAM = /^claude(\.exe)?$/i;

/**
 * Whether a process is Claude Code running a session. teamrig ends a recorded session's process by this check
 * (restart, idle close, close), so it matches Claude Code's own binary exactly, never a word in a command line: a
 * process id the system gave another program since must not pass, nor a Node.js script under a `.claude` folder (a
 * plugin's bin or a hook) in a session's lineage (security condition C1 and note N1 of T4891).
 */
export function isSessionProcess(process: RunningProgram): boolean {
  return CLAUDE_PROGRAM.test(process.name);
}
