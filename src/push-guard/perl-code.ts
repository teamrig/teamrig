import { inlineCode, interpreterOf } from '../package-guard/inline-code.ts';
import { programName, type ProgramLaunch } from './launchers.ts';
import type { ShellWord } from './tokenizer.ts';

/**
 * What the push guard reads of a perl one-liner's own code (`perl -e`, `-E`, `-ne`, `-pe`). Backticks in a perl
 * string, pattern or comment are text perl never runs, so they are no command; backticks in its code, `qx`,
 * `system`, `exec` and the like run one. The reading is careful: it answers 'none' only when it reads every part
 * of the code and finds nothing that may run a command or code it cannot see.
 */

/** 'none': the code runs no command; 'runs': it may run one; 'unknown': the reading cannot tell. */
export type PerlReading = 'none' | 'runs' | 'unknown';

/** A perl call's inline code, the words that hold it, and what the code may run. */
export interface PerlCode {
  readonly code: string;
  /** The arguments perl reads as code: each `-e` value. None for code read on stdin. */
  readonly words: readonly ShellWord[];
  readonly reading: PerlReading;
}

/** Words that run a command, load code from a file or run a string as code. */
const RUNNERS = new Set([
  'system', 'exec', 'qx', 'readpipe', 'open', 'pipe', 'fork', 'syscall', 'eval', 'do', 'require', 'use', 'no', 'dump',
  'goto',
]);
/**
 * The same words anywhere in the code, for code the reading cannot follow. Backticks are left out: the push guard
 * reads those as held text already.
 */
export const PERL_RUNNERS = /\b(?:system|exec|qx|readpipe|open|pipe|fork|syscall|eval|do|require|use|no|dump|goto)\b/;
/** Words that take a quoted body: `q{}`, `m//`, `s///`, `tr///`. */
const QUOTE_WORDS = new Set(['q', 'qq', 'qw', 'qr', 'm', 's', 'tr', 'y', 'qx']);
/** Words after which perl reads a term, so a `/` starts a pattern: `print if /x/`, `split /,/`. */
const TERM_WORDS = new Set([
  'if', 'unless', 'while', 'until', 'and', 'or', 'not', 'xor', 'x', 'lt', 'gt', 'le', 'ge', 'eq', 'ne', 'cmp',
  'return', 'split', 'grep', 'map', 'join', 'push', 'unshift', 'print', 'say', 'printf', 'die', 'warn', 'defined',
  'ref', 'scalar', 'lc', 'uc', 'lcfirst', 'ucfirst', 'length', 'chomp', 'chop', 'chr', 'ord', 'sort', 'reverse',
  'keys', 'values', 'each', 'delete', 'exists', 'for', 'foreach', 'else', 'elsif', 'my', 'our', 'local',
]);
/** Options that load code perl does not get on the line: a module (`-M`, `-m`), the debugger (`-d`), `-x`. */
const LOADS = /^-[A-Za-z]*[Mmdx]/;
/** A cluster where `-i` takes the rest as its backup suffix: in `-pie` the `e` is a suffix, not `-e`. */
const SUFFIXED = /^-[A-Za-z]*i[A-Za-z]/;
/**
 * Code inside an interpolating string or a pattern: `@{[ ]}`, `${\ }`, `$#{ }`, a subscript such as `$h{...}` or
 * `$a[...]`, or a pattern's code block, `(?{ })`, `(??{ })` or `(*{ })`. A subscript may follow any variable name:
 * a word, one with the old `'` package separator (`$x'y` is `$x::y`), a caret name such as `$^W` or one punctuation
 * character such as `$-` or `@+`; perl runs it as code. So may any `->` after a name: a postfix dereference such as
 * `$x->@[...]` interpolates under `-E`.
 */
const STRING_CODE = /[$@]\s*\{(?!\^?\w+\})|\$#\{|[$@](?:\^\w|[^\w\s]|[\w:']+)\s*(?:\[|\{|->)|\((?:\?\??|\*)\{/;

/**
 * The inline code a perl call runs and what it may run, or undefined for any other call and for perl code read
 * from a file. Words after perl's first plain argument or `--` are its arguments, never code, so a reading that
 * takes one as code is 'unknown'; so is a call with an option or variable that loads code from elsewhere.
 */
export function perlCodeOf(launched: ProgramLaunch, stdin: ShellWord | undefined): PerlCode | undefined {
  const interpreter = interpreterOf('perl');
  if (programName(launched.program.text) !== 'perl' || interpreter === undefined) {
    return undefined;
  }
  const { args } = launched;
  const inline = inlineCode({ name: 'perl', args, stdin }, interpreter);
  if (inline === undefined) {
    return undefined;
  }
  const { codeArgs } = inline;
  const words = codeArgs.map((index) => args[index]).filter((word) => word !== undefined);
  // perl runs each `-e` as one line of a single program.
  const code = words.length > 0 ? words.map((word) => word.text).join('\n') : inline.code;
  const options = optionsEnd(args, codeArgs);
  const loads = (word: ShellWord, index: number): boolean =>
    !codeArgs.includes(index) && (LOADS.test(word.text) || SUFFIXED.test(word.text));
  const readable =
    words.every((word) => !word.dynamic) &&
    codeArgs.every((index) => index < options) &&
    !args.slice(0, options).some(loads) &&
    !launched.env.some(({ name }) => name.startsWith('PERL'));
  return { code, words, reading: readable ? readPerl(code) : 'unknown' };
}

/** Where perl's own options end: at its first plain argument, or after `--`. */
function optionsEnd(args: readonly ShellWord[], codeArgs: readonly number[]): number {
  for (const [index, word] of args.entries()) {
    if (codeArgs.includes(index)) {
      continue;
    }
    if (word.text === '--') {
      return index + 1;
    }
    if (!word.text.startsWith('-') || word.text === '-') {
      return index;
    }
  }
  return args.length;
}

/** What perl reads after a token: a term, where `/` starts a pattern; an operator, where it divides; or either. */
type Expect = 'term' | 'operator' | 'either';

/** Reads perl code token by token; see {@link PerlCode}. */
export function readPerl(code: string): PerlReading {
  return new PerlReader(code).read();
}

class PerlReader {
  private readonly code: string;
  private index = 0;
  private expect: Expect = 'term';

  constructor(code: string) {
    this.code = code;
  }

  read(): PerlReading {
    const { code } = this;
    while (this.index < code.length) {
      const char = code[this.index] ?? '';
      const next = code[this.index + 1] ?? '';
      let step: PerlReading | undefined;
      if (/\s/.test(char)) {
        this.index += 1;
      } else if (char === '=' && (this.index === 0 || code[this.index - 1] === '\n') && /[A-Za-z]/.test(next)) {
        // A POD block: perl skips it up to `=cut`.
        return 'unknown';
      } else if (char === '#') {
        const end = code.indexOf('\n', this.index);
        this.index = end === -1 ? code.length : end;
      } else if (char === '`') {
        return 'runs';
      } else if (char === "'" || char === '"') {
        step = this.quoted(char === '"', char);
      } else if (char === '$' || char === '@' || char === '%' || char === '&' || char === '*') {
        step = this.sigil(char, next);
      } else if (char === '-' && next === '>') {
        step = this.arrow();
      } else if (/[A-Za-z_]/.test(char)) {
        step = this.word();
      } else if (/\d/.test(char)) {
        this.index += (/^\d\w*(?:\.(?!\.)\w*)?/.exec(code.slice(this.index))?.[0] ?? char).length;
        this.expect = 'operator';
      } else if (char === '/') {
        step = this.slash();
      } else if (char === '<') {
        step = this.angle(next);
      } else if (char === '?' && this.expect !== 'operator') {
        // Where a term comes, perls before 5.22 read `?...?` as a pattern.
        return 'unknown';
      } else {
        this.index += 1;
        this.expect = char === ')' || char === ']' ? 'operator' : char === '}' ? 'either' : 'term';
      }
      if (step !== undefined) {
        return step;
      }
    }
    return 'none';
  }

  /** A string in quotes at the code's level; interpolating ones must hold no code. */
  private quoted(interpolates: boolean, delimiter: string): PerlReading | undefined {
    const body = this.body(delimiter);
    if (body === undefined || (interpolates && STRING_CODE.test(unescaped(body)))) {
      return 'unknown';
    }
    this.expect = 'operator';
    return undefined;
  }

  /**
   * A variable, a call through `&` or a dereference, which may reach anything, so it may run. `%`, `&` and `*` after
   * a term are operators. `@ARGV` counts as running: perl opens the names it holds, and a name may end in a pipe.
   */
  private sigil(sigil: string, next: string): PerlReading | undefined {
    if ((sigil === '%' || sigil === '&' || sigil === '*') && (this.expect === 'operator' || next === sigil)) {
      this.index += next === sigil ? 2 : 1;
      this.expect = 'term';
      return undefined;
    }
    if ((sigil === '%' || sigil === '*') && this.expect === 'either') {
      // After a bare word or a `}` perl may read `%` and `*` as modulo and multiply: `time % 2`, `$h{a} * 3`.
      return 'unknown';
    }
    // perl allows blanks after a sigil: `@ {...}` is `@{...}`.
    const rest = this.code.slice(this.index + 1).trimStart();
    if (sigil === '&' || rest.startsWith('{') || /^\$[\w{$:]/.test(rest) || (sigil === '$' && /^#[{$]/.test(rest))) {
      return 'runs';
    }
    const name = /^(?:#?(?:\^\w|[\w:]+)|.)/s.exec(rest)?.[0] ?? '';
    if (sigil !== '$' && /^[`'"]/.test(name)) {
      // Only `$` takes a backtick or a quote as its name (`$``, `$'`); the reading guesses none for another sigil.
      return 'unknown';
    }
    this.index = this.code.length - rest.length + name.length;
    this.expect = 'operator';
    return this.oldSeparator() ? 'unknown' : /\bARGV\b/.test(name) ? 'runs' : undefined;
  }

  /** `->`: a method by name, a subscript, or a call through a reference, which may run anything. */
  private arrow(): PerlReading | undefined {
    this.index += 2;
    const rest = this.code.slice(this.index).trimStart();
    if (/^[[{]/.test(rest)) {
      this.expect = 'term';
      return undefined;
    }
    if (/^[A-Za-z_]/.test(rest)) {
      const name = /^[\w:]+/.exec(rest)?.[0] ?? '';
      this.index = this.code.length - rest.length + name.length;
      this.expect = 'operator';
      return this.oldSeparator() ? 'unknown' : undefined;
    }
    return 'runs';
  }

  /** True at the old package separator after a name: `Foo'bar` and `$x'y` are `Foo::bar` and `$x::y` to perl. */
  private oldSeparator(): boolean {
    return this.code[this.index] === "'" && /[A-Za-z_]/.test(this.code[this.index + 1] ?? '');
  }

  /** A bare word: a quoted body, a word that runs something, or a name. */
  private word(): PerlReading | undefined {
    const { code } = this;
    const start = this.index;
    const word = /^[A-Za-z_]\w*(?:::\w+)*/.exec(code.slice(start))?.[0] ?? '';
    this.index += word.length;
    if (this.oldSeparator()) {
      return 'unknown';
    }
    const last = word.split('::').at(-1) ?? word;
    if (RUNNERS.has(last) || /^(?:ARGV|format)$/.test(last)) {
      return 'runs';
    }
    if (!word.includes('::') && QUOTE_WORDS.has(word)) {
      const rest = code.slice(this.index);
      const before = code.slice(0, start).trimEnd();
      if (/^\s*=>/.test(rest)) {
        this.expect = 'operator';
        return undefined;
      }
      if (before.endsWith('-') || /\b(?:sub|package)$/.test(before) || (before.endsWith('{') && /^\s*\}/.test(rest))) {
        // A file test such as `-s $f`, a name such as `sub s`, or a hash key such as `$h{s}`: not a body.
        return 'unknown';
      }
      return this.quoteWord(word);
    }
    this.expect = TERM_WORDS.has(word) ? 'term' : 'either';
    return undefined;
  }

  /** The body of `q`, `qq`, `qw`, `qr`, `m`, `s`, `tr`, `y` or `qx` and its flags. */
  private quoteWord(word: string): PerlReading | undefined {
    const { code } = this;
    const spaced = /^\s/.test(code.slice(this.index));
    this.index += (/^\s*/.exec(code.slice(this.index))?.[0] ?? '').length;
    const delimiter = code[this.index] ?? '';
    if (delimiter === '' || /[\w\s]/.test(delimiter) || (spaced && delimiter === '#')) {
      return 'unknown';
    }
    const first = this.body(delimiter);
    if (first === undefined) {
      return 'unknown';
    }
    const bodies = [first];
    if (word === 's' || word === 'tr' || word === 'y') {
      let second: string | undefined;
      if (CLOSERS[delimiter] === undefined) {
        // The second part shares the first's closing delimiter: step back onto it.
        this.index -= 1;
        second = this.body(delimiter);
      } else {
        this.index += (/^\s*/.exec(code.slice(this.index))?.[0] ?? '').length;
        const again = code[this.index] ?? '';
        second = again === '' || /[\w\s#]/.test(again) ? undefined : this.body(again);
      }
      if (second === undefined) {
        return 'unknown';
      }
      bodies.push(second);
    }
    const flags = /^[A-Za-z]*/.exec(code.slice(this.index))?.[0] ?? '';
    this.index += flags.length;
    if (word === 'qx') {
      return 'runs';
    }
    // With `/e` the replacement is code; `tr`, `y`, `q` and `qw` interpolate nothing.
    const interpolated = !/^(?:tr|y|q|qw)$/.test(word) && bodies.some((body) => STRING_CODE.test(unescaped(body)));
    if ((word === 's' && flags.includes('e')) || interpolated) {
      return 'unknown';
    }
    this.expect = 'operator';
    return undefined;
  }

  /** A `/`: a pattern where a term comes, a division or `//` after one; unknown where perl could read either. */
  private slash(): PerlReading | undefined {
    if (this.expect === 'operator') {
      this.index += this.code[this.index + 1] === '/' ? 2 : 1;
      this.expect = 'term';
      return undefined;
    }
    if (this.expect === 'either') {
      return 'unknown';
    }
    const body = this.body('/');
    if (body === undefined || STRING_CODE.test(unescaped(body))) {
      return 'unknown';
    }
    this.index += (/^[A-Za-z]*/.exec(this.code.slice(this.index))?.[0] ?? '').length;
    this.expect = 'operator';
    return undefined;
  }

  /** A `<`: a here-document, which the reading does not follow; `<FH>` or `<>`; or an operator. */
  private angle(next: string): PerlReading | undefined {
    const rest = this.code.slice(this.index);
    if (rest.startsWith('<<>>')) {
      this.index += 4;
      this.expect = 'operator';
      return undefined;
    }
    if (this.expect !== 'operator') {
      const handle = next === '<' ? undefined : /^<[^<>\s'"`]*>/.exec(rest)?.[0];
      if (handle === undefined) {
        return 'unknown';
      }
      this.index += handle.length;
      this.expect = 'operator';
      return undefined;
    }
    this.index += next === '<' ? 2 : 1;
    this.expect = 'term';
    return undefined;
  }

  /**
   * The text between the delimiter at the reading's place and its close, which a backslash escapes; bracket
   * delimiters nest. Leaves the place after the close. Undefined when it never closes.
   */
  private body(open: string): string | undefined {
    const { code } = this;
    const close = CLOSERS[open] ?? open;
    let depth = 0;
    for (let index = this.index + 1; index < code.length; index += 1) {
      const char = code[index];
      if (char === '\\') {
        index += 1;
      } else if (char === close && depth === 0) {
        const body = code.slice(this.index + 1, index);
        this.index = index + 1;
        return body;
      } else if (close !== open && char === open) {
        depth += 1;
      } else if (close !== open && char === close) {
        depth -= 1;
      }
    }
    return undefined;
  }
}

/** The closing delimiter of each bracket pair. */
const CLOSERS: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}', '<': '>' };

/** A body with each escaped character blanked, so `\$x{` is no subscript. */
function unescaped(body: string): string {
  return body.replace(/\\[\s\S]/g, '  ');
}
