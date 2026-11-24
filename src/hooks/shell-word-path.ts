import type { ShellDialect, ShellWord } from '../push-guard/tokenizer.ts';

/**
 * A shell word as the path the shell hands on, for a guard that holds a path from a shell line (the install guard,
 * T5355 S1, S2): quotes and escapes are already gone (the tokenizer), a leading `~` and the variables the call's
 * environment holds are expanded, and what only the running shell knows is marked. A glob character outside quotes
 * may match any name, and so may a variable the environment lacks or a substitution, which also ends what can be
 * read of the word, as its value may hold more of the path.
 */

/** Stands for any run of characters inside one segment: `*`, a variable the environment lacks. */
export const ANY = '\u{E000}';
/** Stands for one character: `?`, or a `[...]` class. */
export const ONE = '\u{E001}';
/** Stands for what only the running shell knows, up to the word's end: a substitution, a brace list. */
export const REST = '\u{E002}';

/** What a word's path is built from: the user home, the call's environment and the platform. */
export interface WordPathEnv {
  readonly home: string;
  readonly platform: NodeJS.Platform;
  readonly variables: Readonly<Record<string, string | undefined>>;
}

/** A variable's value, matched by name in any case on Windows, as its shells look it up. */
function variableOf(name: string, env: WordPathEnv): string | undefined {
  if (env.platform !== 'win32') {
    return env.variables[name];
  }
  const lower = name.toLowerCase();
  return Object.entries(env.variables).find(([key]) => key.toLowerCase() === lower)?.[1];
}

/** A variable's value as path text, or {@link ANY} when the environment lacks it or holds it empty. */
function expanded(name: string, env: WordPathEnv): string {
  const value = variableOf(name, env);
  return value === undefined || value === '' ? ANY : value;
}

/** Text a glob reads, with its `*`, `?` and `[...]` marked; a `[` with no `]` in its segment stays a plain character. */
function globbed(text: string): string {
  return text
    .replace(/\[[^\]\\/]+\]/g, ONE)
    .replaceAll('*', ANY)
    .replaceAll('?', ONE);
}

/** A leading `~` alone or before a separator, as the user home. */
function homeExpanded(text: string, env: WordPathEnv): string {
  return /^~(?=[\\/]|$)/.test(text) ? `${env.home}${text.slice(1)}` : text;
}

/** A bash word read through its parts: quoted text stays plain, unquoted text globs, a variable expands. */
function bashPath(word: ShellWord, env: WordPathEnv): string {
  const { parts } = word;
  if (parts === undefined) {
    const at = word.text.search(/[$`{]/);
    const head = at === -1 ? word.text : word.text.slice(0, at);
    return `${globbed(homeExpanded(head, env))}${at === -1 ? '' : REST}`;
  }
  return parts
    .map((part, index) => {
      if (part.kind === 'variable') {
        return expanded(part.name, env);
      }
      const text = index === 0 && !part.quoted ? homeExpanded(part.text, env) : part.text;
      return part.quoted ? text : globbed(text);
    })
    .join('');
}

/** A PowerShell variable reference: `${env:X}`, `$env:X`, `${X}` or `$X`; anything else after a `$` ends the word. */
const POWERSHELL_VARIABLE = /\$(?:\{env:([^}]+)\}|env:(\w+)|\{([^}:]+)\}|(\w+))/iy;

/** A PowerShell word: `$HOME` is the user home, `$env:X` the environment's, other variables any name. */
function powershellPath(word: ShellWord, env: WordPathEnv): string {
  const text = homeExpanded(word.text, env);
  if (!word.dynamic) {
    return globbed(text);
  }
  let path = '';
  for (let at = 0; at < text.length; ) {
    const dollar = text.indexOf('$', at);
    if (dollar === -1) {
      return path + globbed(text.slice(at));
    }
    path += globbed(text.slice(at, dollar));
    POWERSHELL_VARIABLE.lastIndex = dollar;
    const match = POWERSHELL_VARIABLE.exec(text);
    if (match === null) {
      return path + REST;
    }
    const [whole, braceEnv, plainEnv, braceName, plainName] = match;
    const environment = braceEnv ?? plainEnv;
    const name = braceName ?? plainName ?? '';
    path += environment !== undefined ? expanded(environment, env) : name.toLowerCase() === 'home' ? env.home : ANY;
    at = dollar + whole.length;
  }
  return path;
}

/** A cmd word: `%X%` expands, `!X!` and an unpaired `%` are only known when it runs. */
function cmdPath(word: ShellWord, env: WordPathEnv): string {
  const text = globbed(word.text);
  if (!word.dynamic) {
    return text;
  }
  const replaced = text.replace(/%([^%\s]+)%/g, (_whole, name: string) => expanded(name, env));
  const open = replaced.search(/[%!]/);
  return open === -1 ? replaced : `${replaced.slice(0, open)}${REST}`;
}

/**
 * The path a word hands on, with {@link ANY}, {@link ONE} and {@link REST} marking what only the running shell
 * knows, or undefined when nothing of it is known before the first such part (`$(pwd)/x`): such a word names no
 * folder the guard could hold it to.
 */
export function wordPathOf(word: ShellWord, dialect: ShellDialect, env: WordPathEnv): string | undefined {
  const path = dialect === 'bash' ? bashPath(word, env) : dialect === 'powershell' ? powershellPath(word, env) : cmdPath(word, env);
  return path === '' || /^[\u{E002}]/u.test(path) || (word.dynamic && /^[\u{E000}]/u.test(path)) ? undefined : path;
}

/** True when the path holds a part only the running shell knows. */
export function isPattern(path: string): boolean {
  return /[\u{E000}-\u{E002}]/u.test(path);
}

/** A segment with marks as a pattern over one name; `flags` is `i` on Windows. */
export function segmentRegExp(segment: string, flags: string): RegExp {
  const source = [...segment]
    .map((character) => {
      if (character === ANY || character === REST) {
        return '[^\\\\/]*';
      }
      if (character === ONE) {
        return '[^\\\\/]';
      }
      return character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`, flags);
}
