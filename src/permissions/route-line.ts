import { isStaticWord, parseShell, type ShellCommand, type ShellParse } from '../push-guard/tokenizer.ts';

/**
 * The first gate of a sanctioned route (T679, security ruling C1): a Bash line is one plain command whose words are
 * their own text, so the words a route matches are the words bash runs. Two layers, each enough to refuse: a scan of
 * the raw text, which no gap in the tokenizer can pass, then the parse. A quoted commit message holding `;`, `>` or `#`
 * is refused too: it simply matches no route, and the call goes on to the prompt as before. The one join a route line
 * may carry is a single `|` into a filter ({@link routeLineOf}, T5070 F2).
 */

/** A standalone `2>&1`, the one redirection a route line may carry; the scan takes it out before it looks. */
const STDERR_TO_STDOUT = /(?<=^|[ \t])2>&1(?=[ \t]|$)/g;

/**
 * A whole bare word naming a pull request or issue, `<owner>/<name>#<number>` (parseIssueTarget), whose `#` the scan
 * lets through (T5070, amending F2): bash and PowerShell start a comment only at a word's start, so a `#` inside a word
 * is literal, and a route like `teamrig pr approve` takes such a target. The whole word is anchored and bare, from an
 * owner starting with a letter or digit (T5098 W1, W2); any other `#` stays refused.
 */
const PULL_TARGET_WORD = /(?<=^|[ \t])[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+#[1-9][0-9]{0,9}(?=[ \t]|$)/g;

/**
 * Text that may join, feed, redirect or substitute another command, refused even inside quotes; `#`, whose comment
 * bash skips, so an allowed line never carries text the matcher did not judge; and `$'` and `$"`, whose value is not the
 * text the line shows (T1994), which no route needs.
 */
const JOINS = /[;&|<>`#]|\$[({'"]/;

/**
 * What a filter's side of the pipe may not hold beyond {@link JOINS}: a redirection, and a double quote, inside which
 * bash may expand `$` (F2); its pattern is a bare word or single-quoted.
 */
const FILTER_REFUSES = /[>&"]/;

/** A leading `NAME=value` word, which sets a variable for the command instead of naming its program. */
const ASSIGNMENT = /^[A-Za-z_]\w*=/;

/** A route line's words, and the words of the filter it pipes into, if any. */
export interface RouteLine {
  readonly words: readonly string[];
  readonly filter: readonly string[] | undefined;
}

/**
 * The words of `line` when it is one plain bash command, else undefined. `scanned` is the text the raw scan reads: the
 * line itself, or a copy whose parts a narrower reader proved literal were masked (service-role-call.ts).
 */
export function plainWordsOf(line: string, scanned: string = line): readonly string[] | undefined {
  if (!scansPlain(scanned)) {
    return undefined;
  }
  return plainWordsIn(onlyCommandOf(parseShell(line, 'bash')));
}

/**
 * A route line (T5070 F2): one plain command, or one plain command piped by a single top-level `|` into a second plain
 * command, the filter. Each side passes the raw scan on its own, the filter's with no redirection and no double quote,
 * and the parse of the whole line must find those same two commands joined by that `|` alone, so a `|` that bash reads
 * inside a word (quoted or escaped) is never taken for the pipe. Which filters may run is the caller's to judge.
 */
export function routeLineOf(line: string): RouteLine | undefined {
  const words = plainWordsOf(line);
  if (words !== undefined) {
    return { words, filter: undefined };
  }
  const bar = line.indexOf('|');
  if (bar === -1 || line.indexOf('|', bar + 1) !== -1) {
    return undefined;
  }
  const left = line.slice(0, bar);
  const right = line.slice(bar + 1);
  if (!scansPlain(left) || !scansPlain(right) || FILTER_REFUSES.test(right)) {
    return undefined;
  }
  const commands = pipedCommandsOf(parseShell(line, 'bash'));
  const piped = commands === undefined ? undefined : plainWordsIn(commands.route, '|');
  const filter = commands === undefined ? undefined : plainWordsIn(commands.filter);
  const sides = [plainWordsOf(left), plainWordsOf(right)];
  return piped !== undefined && filter !== undefined && sameWords(sides[0], piped) && sameWords(sides[1], filter) ? { words: piped, filter } : undefined;
}

function sameWords(one: readonly string[] | undefined, other: readonly string[]): boolean {
  return one !== undefined && one.length === other.length && one.every((word, at) => word === other[at]);
}

/**
 * The raw scan: no control character but a tab (a newline included), nothing that joins commands or starts a comment,
 * outside a lone `2>&1` and the `#` of a pull target word.
 */
function scansPlain(line: string): boolean {
  const scanned = line.replace(STDERR_TO_STDOUT, ' ').replace(PULL_TARGET_WORD, (word) => word.replace('#', '-'));
  return !JOINS.test(scanned) && ![...scanned].some(isControl);
}

function isControl(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (code < 0x20 && character !== '\t') || code === 0x7f;
}

/** The words of a plain command ending in `terminator`, unless its program word is a variable assignment. */
function plainWordsIn(command: ShellCommand | undefined, terminator = ''): readonly string[] | undefined {
  if (command === undefined || !isPlainCommand(command, terminator)) {
    return undefined;
  }
  const words = command.words.map((word) => word.text);
  const [program] = words;
  return program === undefined || ASSIGNMENT.test(program) ? undefined : words;
}

/** True when the parse read the whole line with confidence. */
function readsClear(parse: ShellParse): boolean {
  return parse.complete && !parse.skipped && !parse.bindingsUnclear && parse.unreadBodies.length === 0;
}

/** The parse's one command, when the parse read the whole line with confidence. */
function onlyCommandOf(parse: ShellParse): ShellCommand | undefined {
  const [command, ...more] = parse.commands;
  return readsClear(parse) && more.length === 0 ? command : undefined;
}

/** The parse's two commands, a route and its filter, when the parse read the whole line with confidence. */
function pipedCommandsOf(parse: ShellParse): { readonly route: ShellCommand; readonly filter: ShellCommand } | undefined {
  const [route, filter, ...more] = parse.commands;
  return readsClear(parse) && route !== undefined && filter !== undefined && more.length === 0 ? { route, filter } : undefined;
}

/** A top-level command of static words, no stdin from the line, and no redirection but `2>&1`. */
function isPlainCommand(command: ShellCommand, terminator: string): boolean {
  return (
    command.nesting === 0 &&
    command.subshells.length === 0 &&
    command.terminator === terminator &&
    command.stdin === undefined &&
    command.redirections.every((redirection) => redirection.operator === '2>&1' && redirection.target === undefined) &&
    command.words.length > 0 &&
    command.words.every((word) => isStaticWord(word) && word.held === undefined)
  );
}
