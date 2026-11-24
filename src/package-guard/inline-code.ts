import type { ProgramRun } from './programs.ts';

/**
 * The code an interpreter call runs inline (`node -e`, `python -c`, `perl -e`), read from its arguments. The secret
 * guard reads it for what it prints; it sits beside the program reader so any guard can read it the same way.
 */

export type Family = 'js' | 'python' | 'ruby' | 'perl' | 'php';

export interface Interpreter {
  readonly family: Family;
  /** Options whose value is the code to run: `node -e`, `python -c`. */
  readonly code: readonly string[];
  /** Options that print what the code gives, or each line it reads: `node -p`, `perl -p`. */
  readonly print: readonly string[];
  /** For perl and ruby: short options run together, as in `-ne` or `-pi`. */
  readonly clusters: boolean;
  /** In a cluster, the options whose value is the rest of the word: `-rpp` requires pp, it prints nothing. */
  readonly valued: string;
}

const JS: Interpreter = { family: 'js', code: ['-e', '--eval', '-p', '--print'], print: ['-p', '--print'], clusters: false, valued: '' };
const PYTHON: Interpreter = { family: 'python', code: ['-c'], print: [], clusters: false, valued: '' };

const INTERPRETERS: ReadonlyMap<string, Interpreter> = new Map([
  ['node', JS],
  ['bun', JS],
  ['tsx', JS],
  ['ts-node', JS],
  ['deno', JS],
  ['python', PYTHON],
  ['python3', PYTHON],
  ['python2', PYTHON],
  ['py', PYTHON],
  ['pythonw', PYTHON],
  ['ruby', { family: 'ruby', code: ['-e'], print: ['-p'], clusters: true, valued: 'rICxEFK' }],
  ['perl', { family: 'perl', code: ['-e', '-E'], print: ['-p'], clusters: true, valued: 'IMmxdCFD' }],
  ['php', { family: 'php', code: ['-r'], print: [], clusters: false, valued: '' }],
]);

/** The program a call runs and what it is handed: its name as the guards compare it, its arguments and its stdin. */
export type InlineRun = Pick<ProgramRun, 'name' | 'args' | 'stdin'>;

/** The code an interpreter call runs inline, whether an option makes it print, and the words it gets as arguments. */
export interface InlineCode {
  readonly code: string;
  readonly printOption: boolean;
  readonly argv: readonly string[];
  /** The place in the arguments of each word read as code, in order; empty for code read on stdin. */
  readonly codeArgs: readonly number[];
}

/** The interpreter a program name starts, or undefined when it is none the guards read. */
export function interpreterOf(name: string): Interpreter | undefined {
  return INTERPRETERS.get(name);
}

/** The code the call runs inline, or undefined when it runs a script file or nothing. */
export function inlineCode(run: InlineRun, interpreter: Interpreter): InlineCode | undefined {
  const texts = run.args.map((arg) => arg.text);
  let printOption = false;
  let code: string | undefined;
  const argv: string[] = [];
  const codeArgs: number[] = [];
  let index = run.name === 'deno' ? texts.indexOf('eval') + 1 : 0;
  if (run.name === 'deno' && index === 0) {
    return undefined;
  }
  for (; index < texts.length; index += 1) {
    const text = texts[index] ?? '';
    const valued = /^(--eval|--print)=(.*)$/s.exec(text);
    const cluster = interpreter.clusters && /^-[a-zA-Z]+$/.test(text) ? clusterOptions(text.slice(1), interpreter.valued) : undefined;
    if (code !== undefined && !text.startsWith('-')) {
      argv.push(text);
    } else if (valued !== null) {
      code = valued[2];
      codeArgs.push(index);
      printOption ||= interpreter.print.includes(valued[1] ?? '');
    } else if (interpreter.code.includes(text) || (cluster !== undefined && interpreter.code.some((option) => cluster.endsWith(option.slice(1))))) {
      printOption ||= interpreter.print.includes(text) || (cluster?.includes('p') ?? false);
      code = texts[index + 1];
      codeArgs.push(index + 1);
      index += 1;
    } else if (interpreter.print.includes(text) || (cluster?.includes('p') ?? false)) {
      printOption = true;
    } else if (run.name === 'deno' && code === undefined && !text.startsWith('-')) {
      code = text;
      codeArgs.push(index);
    } else if (!text.startsWith('-') || text === '-') {
      const stdin = text === '-' ? run.stdin : undefined;
      const after = texts.slice(index + 1);
      return stdin === undefined ? undefined : { code: stdin.text, printOption, argv: after, codeArgs: [] };
    }
  }
  if (code === undefined) {
    return run.stdin === undefined ? undefined : { code: run.stdin.text, printOption, argv, codeArgs: [] };
  }
  return { code, printOption, argv, codeArgs };
}

/** The option letters of a cluster: up to and with the first one whose value is the rest of the word. */
function clusterOptions(letters: string, valued: string): string {
  const end = [...letters].findIndex((letter) => valued.includes(letter));
  return end === -1 ? letters : letters.slice(0, end + 1);
}
