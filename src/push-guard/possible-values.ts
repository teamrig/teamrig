import { ASSIGNMENT_LIKE } from './setters.ts';
import type { Redirection, ShellCommand, ShellParse, ShellWord } from './tokenizer.ts';
import { exportedBinding, Fields, HEREDOC_OPERATOR, plainBinding, reservedWordText, type ValuePart, type ValuePiece } from './variables.ts';

/**
 * Every value a bash line may give its variables where they are read, for a guard that refuses a line when any of
 * them reaches what it guards (the install guard, T5378). `resolveLiteralVariables` (variables.ts) gives a variable only a
 * value that surely holds, which suits a guard that asks about a word it cannot read; a guard that passes such a
 * word needs the other side: each value the line assigns the name anywhere, inside a compound command or a
 * function, through `declare`, `local` or `readonly`, before or after the read, as any of them may be the one it
 * holds when it runs.
 */

/**
 * bash builtins whose `NAME=value` operands bind NAME, each with the option letters that leave the value as written
 * (export, read-only, global, print). Any other letter may change what the name gives (`-l`, `-u` change case, `-n`
 * makes it name another variable, `-a`, `-A`, `-i` read the value another way), so a line reading such a name is
 * not read.
 */
const DECLARATION_BUILTINS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['export', new Set(['f', 'n', 'p'])],
  ['declare', new Set(['x', 'r', 'g', 'p', 'f', 'F', 't'])],
  ['typeset', new Set(['x', 'r', 'g', 'p', 'f', 'F', 't'])],
  ['local', new Set(['x', 'r', 'p', 't'])],
  ['readonly', new Set(['f', 'p'])],
]);

/** Keywords that may start a command ahead of its own words: a compound command's parts, a `{ }` group, a `!`. */
const LEADING_KEYWORDS: ReadonlySet<string> = new Set(['if', 'then', 'elif', 'else', 'do', 'while', 'until', '{', '!', 'time']);

/** A bare variable name, as a declaration builtin's operand without a value names one. */
const BARE_NAME = /^[A-Za-z_]\w*$/;

/**
 * The most readings one line may need, one per choice of a value for each variable it reads; past it the line is
 * not read. A real line binds a name to one or two values, so it needs a handful.
 */
export const MAX_POSSIBLE_READINGS = 64;

/** One value for each variable a reading resolves. */
type Choice = ReadonlyMap<string, readonly ValuePart[]>;

/** What a reading binds: each name's values, and the names a declaration option may give another value. */
interface Bindings {
  readonly values: Map<string, (readonly ValuePart[])[]>;
  readonly changed: ReadonlySet<string>;
}

/**
 * The commands of `parsed` once for each way its variables may be bound (see the module note), an unquoted pattern
 * value kept in the word as unquoted text. `home` is the folder HOME names when the line starts, one more value
 * HOME may hold. Where there is more than one way, each runs in a subshell of its own, an id below every id the
 * parse holds, so a `cd` in one never moves another. A variable the line never assigns, and every variable of a
 * reading that sets IFS, binds an array element or {@link ShellParse.bindingsUnclear} flags, stays as written.
 * Undefined when the line needs more than {@link MAX_POSSIBLE_READINGS} readings, or reads a name a declaration
 * option may change (`declare -l X`): a caller that refuses what it cannot read refuses it.
 */
export function resolvePossibleVariables(parsed: ShellParse, home: string | undefined): readonly ShellCommand[] | undefined {
  const readings = (parsed.readings ?? [parsed]).map((reading) => ({ reading, choices: choicesOf(reading, home) }));
  const count = readings.reduce((total, { choices }) => total + (choices?.length ?? Infinity), 0);
  if (count > MAX_POSSIBLE_READINGS) {
    return undefined;
  }
  let next = Math.min(0, ...parsed.commands.flatMap((command) => command.subshells)) - 1;
  return readings.flatMap(({ reading, choices }) =>
    (choices ?? []).flatMap((choice) => {
      const own = choices !== undefined && choices.length > 1 ? [next--] : [];
      return reading.commands.map((command) => resolveCommand(command, choice, own));
    }),
  );
}

/**
 * Each choice of one value per variable the reading reads; undefined past {@link MAX_POSSIBLE_READINGS}, or when it
 * reads a name a declaration option may change.
 */
function choicesOf(reading: ShellParse, home: string | undefined): readonly Choice[] | undefined {
  const bindings = reading.bindingsUnclear ? undefined : bindingsOf(reading.commands);
  if (bindings === undefined) {
    return [new Map()];
  }
  const { values, changed } = bindings;
  if (home !== undefined) {
    // A Windows home goes to bash with forward slashes, which keep an unquoted `$HOME` from reading as a pattern.
    addValue(values, 'HOME', [{ kind: 'text', text: home.replaceAll('\\', '/') }]);
  }
  const read = readNames(reading.commands, values);
  if (read.some((name) => changed.has(name))) {
    return undefined;
  }
  let choices: Choice[] = [new Map()];
  for (const name of read) {
    const named = values.get(name) ?? [];
    if (named.length === 0) {
      continue;
    }
    if (choices.length * named.length > MAX_POSSIBLE_READINGS) {
      return undefined;
    }
    choices = choices.flatMap((choice) => named.map((value) => new Map([...choice, [name, value]])));
  }
  return choices;
}

/**
 * Every value each name is given anywhere in the line, distinct: a command's leading `NAME=value` words, and the
 * `NAME=value` operands of a {@link DECLARATION_BUILTINS} builtin, with the keywords that start the command
 * skipped; and each operand name of a builtin given an option outside its safe letters, or one only known when it
 * runs. Undefined when the line sets IFS, which splits values another way, or an array element.
 */
function bindingsOf(commands: readonly ShellCommand[]): Bindings | undefined {
  const values = new Map<string, (readonly ValuePart[])[]>();
  const changed = new Set<string>();
  for (const command of commands) {
    const words = withoutLeadingKeywords(command.words);
    const start = words.findIndex((word) => !ASSIGNMENT_LIKE.test(word.text));
    const leading = start < 0 ? words : words.slice(0, start);
    const program = start < 0 ? undefined : words[start];
    const safe = program === undefined || program.dynamic ? undefined : DECLARATION_BUILTINS.get(program.text);
    const operands = safe === undefined ? [] : words.slice(start + 1);
    for (const word of [...leading, ...operands]) {
      const assigned = ASSIGNMENT_LIKE.exec(word.text);
      if (assigned?.[2] === '[' || assigned?.[1] === 'IFS') {
        return undefined;
      }
      const binding = leading.includes(word) ? plainBinding(word) : exportedBinding(word);
      if (binding !== undefined) {
        addValue(values, binding.name, binding.value);
      }
    }
    if (safe !== undefined && !optionsKeepValues(operands, safe)) {
      for (const word of operands) {
        const name = BARE_NAME.test(word.text) ? word.text : ASSIGNMENT_LIKE.exec(word.text)?.[1];
        if (name !== undefined) {
          changed.add(name);
        }
      }
    }
  }
  return { values, changed };
}

/** True when every option word ahead of `--` among `operands` is static and uses only `safe` letters. */
function optionsKeepValues(operands: readonly ShellWord[], safe: ReadonlySet<string>): boolean {
  for (const word of operands) {
    if (word.text === '--') {
      return true;
    }
    if (word.dynamic) {
      return false;
    }
    if (/^[-+]/.test(word.text) && ![...word.text.slice(1)].every((letter) => safe.has(letter))) {
      return false;
    }
  }
  return true;
}

/**
 * `words` from the first that is not a keyword {@link LEADING_KEYWORDS} names, written unquoted; `function` skips
 * the name it defines too.
 */
function withoutLeadingKeywords(words: readonly ShellWord[]): readonly ShellWord[] {
  let start = 0;
  for (let word = words[start]; word !== undefined && reservedWordText(word); word = words[start]) {
    if (word.text === 'function') {
      start += 2;
    } else if (LEADING_KEYWORDS.has(word.text)) {
      start += 1;
    } else {
      break;
    }
  }
  return words.slice(start);
}

/** Adds `value` to the values of `name` unless it is there already. */
function addValue(values: Map<string, (readonly ValuePart[])[]>, name: string, value: readonly ValuePart[]): void {
  const known = values.get(name) ?? [];
  const key = JSON.stringify(value);
  if (!known.some((other) => JSON.stringify(other) === key)) {
    values.set(name, [...known, value]);
  }
}

/** The names the line reads, in its words, its redirection targets or the values it assigns a name it reads. */
function readNames(commands: readonly ShellCommand[], assigned: ReadonlyMap<string, readonly (readonly ValuePart[])[]>): readonly string[] {
  const words = commands.flatMap((command) => [...command.words, ...command.redirections.flatMap((redirection) => (redirection.target === undefined ? [] : [redirection.target]))]);
  const pending = words.flatMap((word) => word.parts ?? []).flatMap((part) => (part.kind === 'variable' ? [part.name] : []));
  const read = new Set<string>();
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (!read.has(name)) {
      read.add(name);
      pending.push(...(assigned.get(name) ?? []).flat().flatMap((part) => (part.kind === 'variable' ? [part.name] : [])));
    }
  }
  return [...read];
}

/** `command` with its words and redirection targets resolved by `choice`, its subshells after `own`. */
function resolveCommand(command: ShellCommand, choice: Choice, own: readonly number[]): ShellCommand {
  return {
    ...command,
    subshells: [...own, ...command.subshells],
    words: command.words.flatMap((word) => resolveWord(word, choice)),
    redirections: command.redirections.map((redirection) => resolveRedirection(redirection, choice)),
  };
}

/** A redirection's target resolved when it expands to one word; a heredoc's delimiter, never expanded, as written. */
function resolveRedirection(redirection: Redirection, choice: Choice): Redirection {
  const { target } = redirection;
  if (target === undefined || HEREDOC_OPERATOR.test(redirection.operator)) {
    return redirection;
  }
  const [only, ...more] = resolveWord(target, choice);
  return only === undefined || more.length > 0 ? redirection : { ...redirection, target: only };
}

/** The words `word` becomes under `choice`, or `word` itself when a variable in it has no value there. */
function resolveWord(word: ShellWord, choice: Choice): readonly ShellWord[] {
  if (!word.dynamic || word.parts === undefined) {
    return [word];
  }
  const fields = new Fields('kept');
  for (const part of word.parts) {
    const value = part.kind === 'text' ? undefined : valueOf(part.name, choice, new Set());
    if (part.kind === 'text') {
      fields.addText(part.text, part.quoted);
    } else if (value === undefined || !fields.addValue(value, part.quoted)) {
      return [word];
    }
  }
  const words = fields.finish();
  return words.length > 0 ? words : [word];
}

/** The value `name` holds under `choice`, a variable in it read the same way; one met again is only known when it runs. */
function valueOf(name: string, choice: Choice, seen: ReadonlySet<string>): readonly ValuePiece[] | undefined {
  const value = seen.has(name) ? undefined : choice.get(name);
  if (value === undefined) {
    return undefined;
  }
  const inner = new Set([...seen, name]);
  return value.flatMap((part): readonly ValuePiece[] =>
    part.kind === 'text' ? [part] : (valueOf(part.name, choice, inner) ?? [{ kind: 'unknown', written: `\${${part.name}}` }]),
  );
}
