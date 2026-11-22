/**
 * Whether a running process is Codex CLI running a session. teamrig ends a recorded session's process by this check
 * (restart, idle close, close), so it matches Codex's own program exactly and no loose substring: a process id the
 * system gave another program since must not pass (security condition C1 of T4891).
 *
 * Codex ships as a native binary, `codex` or `codex.exe`, started through npm's Node.js wrapper
 * `@openai/codex/bin/codex.js` (Codex 0.170.0, `codex-cli/bin/codex.js`): on Windows the wrapper stays the native
 * binary's parent; elsewhere it replaces itself with the binary.
 */

/** A running process by its program's file name and its whole command line, empty when the system shows none. */
export interface CodexProcessView {
  readonly name: string;
  readonly commandLine: string;
}

const CODEX_PROGRAM = /^codex(\.exe)?$/i;
const NODE_PROGRAM = /^node(\.exe)?$/i;
/** The wrapper script as Node.js is handed it: npm's package folder, whatever the slashes or the folder above it. */
const CODEX_SCRIPT = /(?:^|[\\/])@openai[\\/]codex[\\/]bin[\\/]codex\.js$/i;

/** The command line's first words, each as the shell hands it: a double-quoted word without its quotes. */
function leadingWords(commandLine: string, count: number): readonly string[] {
  const words: string[] = [];
  const word = /\s*(?:"([^"]*)"|(\S+))/y;
  while (words.length < count) {
    const match = word.exec(commandLine);
    if (match === null) {
      break;
    }
    words.push(match[1] ?? match[2] ?? '');
  }
  return words;
}

/** Codex's own binary, or Node.js whose first argument is Codex's wrapper script. */
export function isCodexSessionProcess(process: CodexProcessView): boolean {
  if (CODEX_PROGRAM.test(process.name)) {
    return true;
  }
  if (!NODE_PROGRAM.test(process.name)) {
    return false;
  }
  const [, script] = leadingWords(process.commandLine, 2);
  return script !== undefined && CODEX_SCRIPT.test(script);
}
