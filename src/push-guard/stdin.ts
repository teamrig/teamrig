import { programName, type Launch } from './launchers.ts';
import type { ShellCommand, ShellDialect, ShellWord } from './tokenizer.ts';

/**
 * What a command does with the text it reads on stdin: `stored` when a plain `cat` writes it to a file,
 * `passed` when a plain `cat` hands it down a pipe to the next command, `read` for anything else.
 */
export type StdinUse = 'stored' | 'passed' | 'read';

/** A redirection of stdout: `>`, `>>`, `>|`, `1>`, or a copy such as `>&2`. */
const STDOUT = /^1?>/;
/** A redirection that writes stdout to the file it names. */
const FILE_WRITE = /^1?>[>|]?$/;
/** A path into a device or process folder, such as `/dev/stdout` or `/proc/self/fd/1`, which may lead back to a pipe. */
const DEVICE = /(?:^|[\\/])(?:dev|proc)(?:[\\/]|$)/i;
/** A pipe to the next command, maybe after the newline that ends a heredoc's line. */
const PIPE = /^\|&?\n*$/;

/** True when a command takes its stdin from a redirection, such as `< file`, rather than from a pipe. */
export function redirectsInput(command: ShellCommand): boolean {
  return command.redirections.some((redirection) => /^0?</.test(redirection.operator));
}

/** True when a launch is `cat` with no arguments but `-`, so its stdin is all it writes. */
function plainCat(launched: Launch): boolean {
  return (
    launched.kind === 'program' &&
    !launched.program.dynamic &&
    programName(launched.program.text) === 'cat' &&
    !launched.stdinArgs &&
    launched.args.every((arg) => !arg.dynamic && arg.text === '-')
  );
}

/** What `command`, which starts `launched`, does with what it reads on stdin; see {@link StdinUse}. */
export function stdinUse(command: ShellCommand, launched: Launch): StdinUse {
  if (!plainCat(launched)) {
    return 'read';
  }
  const output = command.redirections.findLast((redirection) => STDOUT.test(redirection.operator));
  if (output === undefined) {
    return pipesOn(command) ? 'passed' : 'read';
  }
  const file = output.target;
  return FILE_WRITE.test(output.operator) && file !== undefined && !file.dynamic && !DEVICE.test(file.text) ? 'stored' : 'read';
}

/** True when a command hands its stdout down a pipe to the next command. */
export function pipesOn(command: ShellCommand): boolean {
  return PIPE.test(command.terminator);
}

/** The programs of each dialect that print the words they are given. */
const PRINTERS: Readonly<Record<ShellDialect, ReadonlySet<string>>> = {
  bash: new Set(['echo', 'printf']),
  powershell: new Set(['write-output', 'echo', 'write']),
  cmd: new Set(['echo']),
};

/** The words after the leading ones a pattern matches, such as echo's `-n` and `-e`. */
function withoutLeading(words: readonly ShellWord[], leading: RegExp): readonly ShellWord[] {
  const first = words.findIndex((word) => word.dynamic || !leading.test(word.text));
  return first === -1 ? [] : words.slice(first);
}

/** Words joined into one text, dynamic when any of them is; each keeps a variable as written. */
function joinedText(words: readonly ShellWord[], separator: string): ShellWord {
  return { text: words.map((word) => word.text).join(separator), dynamic: words.some((word) => word.dynamic) };
}

/**
 * The text `command`, which starts `launched`, prints from the line itself, or undefined: `echo` or `printf` with
 * their words (a `\n` escape as the line end it may print), PowerShell's `Write-Output` (an object to a line) or a lone
 * string, a variable kept as written. Undefined too when a redirection sends its stdout elsewhere. A shell the text is
 * piped or substituted into runs it as its commands (T5366 R5).
 */
export function printedText(command: ShellCommand, launched: Launch, dialect: ShellDialect): ShellWord | undefined {
  if (command.redirections.some((redirection) => STDOUT.test(redirection.operator))) {
    return undefined;
  }
  const [head] = command.words;
  if (dialect === 'powershell' && command.words.length === 1 && head?.string === true) {
    return head;
  }
  if (launched.kind !== 'program' || launched.program.dynamic || launched.stdinArgs) {
    return undefined;
  }
  const name = programName(launched.program.text);
  if (!PRINTERS[dialect].has(name)) {
    return undefined;
  }
  if (dialect === 'powershell') {
    return joinedText(
      launched.args.filter((arg) => !/^-(?:noenumerate|inputobject)$/i.test(arg.text)),
      '\n',
    );
  }
  const words = dialect === 'bash' ? withoutLeading(launched.args, name === 'echo' ? /^-[neE]+$/ : /^--$/) : launched.args;
  const text = joinedText(words, ' ');
  return dialect === 'bash' ? { text: text.text.replaceAll('\\n', '\n'), dynamic: text.dynamic } : text;
}
