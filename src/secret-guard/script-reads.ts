import { extname } from 'node:path';
import { NODE_CODE, NODE_NO_SCRIPT, NODE_VALUED } from '../core/node-options.ts';
import type { LineRuns, ProgramRun } from '../package-guard/programs.ts';
import { bashDrivePath, resolveDir } from '../push-guard/location.ts';
import type { ShellDialect, ShellWord } from '../push-guard/tokenizer.ts';
import { scriptCredentialFindings } from './credential-reads.ts';
import type { SecretFinding } from './findings.ts';

/** Reads a script file for the guard. */
export interface ScriptTexts {
  /** The file's text; undefined when it is missing, no file, unreadable or over the guard's size cap. */
  text(path: string): string | undefined;
}

/** For a line run somewhere else (a container, a remote host), whose script files are not on this host. */
export const NO_SCRIPTS: ScriptTexts = { text: () => undefined };

/** A script file a line starts: its word, where it is read from, and whether only a `#!` line shows it is a script. */
interface ScriptEntry {
  readonly word: ShellWord;
  readonly dialect: ShellDialect;
  readonly dir: string | undefined;
  readonly needsShebang: boolean;
}

const NODES: ReadonlySet<string> = new Set(['node', 'tsx', 'ts-node']);
const NODE_STOPS: ReadonlySet<string> = new Set([...NODE_NO_SCRIPT, ...NODE_CODE, '-']);
const PYTHONS: ReadonlySet<string> = new Set(['python', 'python3', 'py']);
const PYTHON_VALUED: ReadonlySet<string> = new Set(['-W', '-X']);
const PYTHON_STOPS: ReadonlySet<string> = new Set(['-c', '-m', '-', '--version', '-V', '--help', '-h']);
const BUN_DENO: ReadonlySet<string> = new Set(['bun', 'deno']);
/** What a script a program word names ends in; a program word with no extension is a script only by its `#!` line. */
const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.py', '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.cmd', '.bat', '.rb', '.pl',
]);

/**
 * The first word of `args` that is no option, skipping each option in `valued` with its value; undefined at an option
 * in `stops`, which runs no script file (inline code the line's own text holds, a module, a test run, stdin).
 */
function firstOperand(args: readonly ShellWord[], valued: ReadonlySet<string>, stops: ReadonlySet<string>): ShellWord | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const text = args[index]?.text ?? '';
    if (stops.has(text) || /^--(?:eval|print)=/.test(text)) {
      return undefined;
    }
    if (text === '--') {
      return args[index + 1];
    }
    if (valued.has(text)) {
      index += 1;
    } else if (!text.startsWith('-') && !text.startsWith('+')) {
      return args[index];
    }
  }
  return undefined;
}

/** The script `bun x.ts`, `bun run x.ts` or `deno run x.ts` runs: the first operand with a script's extension. */
function runnerScript(run: ProgramRun): ShellWord | undefined {
  return run.args.find((arg) => !arg.text.startsWith('-') && SCRIPT_EXTENSIONS.has(extname(arg.text).toLowerCase()));
}

/** The script file a run starts by an interpreter, or as its program when the word is a path to one. */
function scriptEntryOf(run: ProgramRun): ScriptEntry | undefined {
  const byInterpreter = NODES.has(run.name)
    ? firstOperand(run.args, NODE_VALUED, NODE_STOPS)
    : PYTHONS.has(run.name)
      ? firstOperand(run.args, PYTHON_VALUED, PYTHON_STOPS)
      : BUN_DENO.has(run.name)
        ? runnerScript(run)
        : undefined;
  if (byInterpreter !== undefined) {
    return { word: byInterpreter, dialect: run.dialect, dir: run.dir, needsShebang: false };
  }
  const program = run.program.text;
  if (!/[\\/]/.test(program)) {
    return undefined;
  }
  const extension = extname(program).toLowerCase();
  const asProgram = { word: run.program, dialect: run.dialect, dir: run.dir };
  return extension === '' ? { ...asProgram, needsShebang: true } : SCRIPT_EXTENSIONS.has(extension) ? { ...asProgram, needsShebang: false } : undefined;
}

/**
 * The saved credentials the script files a line starts read (T3038): the entry file each program run hands an
 * interpreter or runs as its program, and each file a shell runs (`bash x.sh`, `pwsh -File x.ps1`), read through
 * `scripts` and matched for the store commands, store APIs and teamrig's token names. A word only known when the line
 * runs, a relative path from a folder only known then, and a file `scripts` cannot read hold no finding.
 */
export function scriptReadFindings(runs: Pick<LineRuns, 'programs' | 'files'>, scripts: ScriptTexts, home: string): SecretFinding[] {
  const entries = [
    ...runs.programs.flatMap((run) => scriptEntryOf(run) ?? []),
    ...runs.files.map((run): ScriptEntry => ({ word: run.file, dialect: run.dialect, dir: run.dir, needsShebang: false })),
  ];
  return entries.flatMap((entry) => {
    if (entry.word.dynamic) {
      return [];
    }
    const written = entry.dialect === 'bash' ? bashDrivePath(entry.word.text, home) : entry.word.text;
    const path = resolveDir(entry.dir, written, home);
    const text = path === undefined ? undefined : scripts.text(path);
    return text === undefined || (entry.needsShebang && !text.startsWith('#!')) ? [] : scriptCredentialFindings(text, entry.word.text);
  });
}
