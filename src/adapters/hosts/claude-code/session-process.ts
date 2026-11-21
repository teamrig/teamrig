import type { RunningProgram } from '../../../plugin-api/index.ts';

const CLAUDE_PROGRAM = /^claude(\.exe)?$/i;
const NODE_PROGRAM = /^node(\.exe)?$/i;

/** Whether a process is Claude Code running a session: its own binary, or Node.js running its script. */
export function isSessionProcess(process: RunningProgram): boolean {
  return CLAUDE_PROGRAM.test(process.name) || (NODE_PROGRAM.test(process.name) && /claude/i.test(process.commandLine));
}
