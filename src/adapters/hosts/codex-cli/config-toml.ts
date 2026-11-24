/**
 * Sets one boolean key in Codex CLI's `config.toml` by editing lines, so every other line, comment and table (the
 * person's settings, and the `[hooks.state]` trust Codex keeps there) stays exactly as it was. teamrig ships no TOML
 * library, and a parse and rewrite would drop the person's comments and layout.
 *
 * It reads the TOML the key can sit in: under its `[table]` header, as a dotted key at the root (`table.key = ...`),
 * with bare or quoted key words, beside multi-line strings that may hold lines looking like headers. An inline table
 * (`table = { ... }`) is refused, as the key cannot be added to it line by line.
 */

/** The new text, undefined when the file already reads so, or why it cannot be edited. */
export type TomlEdit = { readonly ok: true; readonly text: string | undefined } | { readonly ok: false; readonly problem: string };

const HEADER = /^\s*\[\s*([^[\]]+?)\s*\]\s*(?:#.*)?$/u;
const ARRAY_HEADER = /^\s*\[\[/u;
const KEY_LINE = /^(\s*)((?:[A-Za-z0-9_-]+|"[^"\n]*"|'[^'\n]*')(?:\s*\.\s*(?:[A-Za-z0-9_-]+|"[^"\n]*"|'[^'\n]*'))*)\s*=\s*(.*)$/u;
const KEY_WORD = /[A-Za-z0-9_-]+|"[^"\n]*"|'[^'\n]*'/gu;
const DELIMITERS = ['"""', "'''"] as const;
type Delimiter = (typeof DELIMITERS)[number];

/** A dotted key's words, unquoted: `a."b".c` is `a.b.c`. */
function keyPath(written: string): string {
  return (written.match(KEY_WORD) ?? []).map((word) => (word.startsWith('"') || word.startsWith("'") ? word.slice(1, -1) : word)).join('.');
}

function count(line: string, delimiter: Delimiter): number {
  return line.split(delimiter).length - 1;
}

/** The multi-line string still open after `line`, given the one open before it. */
function openAfter(line: string, open: Delimiter | undefined): Delimiter | undefined {
  if (open !== undefined) {
    return count(line, open) % 2 === 1 ? undefined : open;
  }
  return DELIMITERS.find((delimiter) => count(line, delimiter) % 2 === 1);
}

interface Found {
  /** The `[table]` header's line, when there is one. */
  header: number | undefined;
  /** The first line holding a root dotted key into the table. */
  rootDotted: number | undefined;
  /** The first table header of any kind, where root keys end. */
  firstHeader: number | undefined;
  /** The line setting the key, with its indent and key as written. */
  key: { readonly line: number; readonly indent: string; readonly written: string; readonly value: string } | undefined;
  inline: boolean;
}

/** A `key = value` line as the walk meets it: where it is, how it was written, and its whole dotted path. */
interface KeyLine {
  readonly line: number;
  readonly indent: string;
  readonly written: string;
  readonly value: string;
  /** The table it sits under, `''` at the root. */
  readonly table: string;
  /** The table's path and the key's, joined: `[a]` then `b.c = 1` is `a.b.c`. */
  readonly path: string;
}

/** The table name an array of tables gives the keys under it, which no `[table]` path can equal. */
const ARRAY_TABLE = '[[array]]';

/**
 * Calls `header` for each table header and `key` for each key line, skipping the lines inside a multi-line string,
 * which may hold text that only looks like a header or a key.
 */
function walk(lines: readonly string[], header: (line: number, table: string) => void, key: (found: KeyLine) => void): void {
  let current = '';
  let open: Delimiter | undefined;
  lines.forEach((line, index) => {
    if (open !== undefined) {
      open = openAfter(line, open);
      return;
    }
    const named = ARRAY_HEADER.test(line) ? undefined : HEADER.exec(line);
    if (ARRAY_HEADER.test(line) || named !== null) {
      current = named?.[1] === undefined ? ARRAY_TABLE : keyPath(named[1]);
      header(index, current);
      return;
    }
    const pair = KEY_LINE.exec(line);
    if (pair !== null) {
      const [, indent = '', written = '', value = ''] = pair;
      const path = current === '' ? keyPath(written) : `${current}.${keyPath(written)}`;
      key({ line: index, indent, written, value, table: current, path });
    }
    open = openAfter(line, undefined);
  });
}

function scan(lines: readonly string[], table: string, key: string): Found {
  const found: Found = { header: undefined, rootDotted: undefined, firstHeader: undefined, key: undefined, inline: false };
  const target = `${table}.${key}`;
  walk(
    lines,
    (index, current) => {
      found.firstHeader ??= index;
      if (current === table) found.header ??= index;
    },
    ({ line, indent, written, value, table: current, path }) => {
      if (path === target) found.key ??= { line, indent, written, value };
      if (current === '' && path === table && value.trimStart().startsWith('{')) found.inline = true;
      if (current === '' && path.startsWith(`${table}.`)) found.rootDotted ??= line;
    },
  );
  return found;
}

/** Whether `value`, a key line's text after `=`, reads as the boolean `word`. */
function reads(value: string, word: string): boolean {
  return new RegExp(`^${word}(?:\\s|#|$)`, 'u').test(value);
}

/**
 * `text` with each `<prefix>.<name>.<rest>` key already written, for any `<name>`, set to `value` where it reads
 * otherwise; no key is added and every other line is kept. For a setting a named sub-table may set again over the
 * root one, such as Codex's `[profiles.<name>.features]` over `[features]`. An inline table under `prefix` that holds
 * the key's last word is refused, as its keys cannot be edited line by line.
 */
export function withBooleanKeyInEach(text: string, prefix: string, rest: string, value: boolean): TomlEdit {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/u);
  const word = String(value);
  const last = rest.split('.').at(-1) ?? rest;
  const edited = [...lines];
  let changed = false;
  let inline: string | undefined;
  walk(
    lines,
    () => undefined,
    ({ line, indent, written, value: current, path }) => {
      const under = path === prefix || path.startsWith(`${prefix}.`);
      if (under && current.trimStart().startsWith('{') && current.includes(last)) inline ??= path;
      const name = path.startsWith(`${prefix}.`) && path.endsWith(`.${rest}`) ? path.slice(prefix.length + 1, -(rest.length + 1)) : '';
      if (name !== '' && !reads(current, word)) {
        edited[line] = `${indent}${written} = ${word}`;
        changed = true;
      }
    },
  );
  if (inline !== undefined) {
    return { ok: false, problem: `it sets ${inline} as an inline table that may hold ${last}, which teamrig cannot edit line by line: write it as a [${inline}] table, or set ${rest} = ${word} in it by hand` };
  }
  return { ok: true, text: changed ? edited.join(eol) : undefined };
}

/** `text` with `table.key` set to `value`, every other line kept. */
export function withBooleanKey(text: string, table: string, key: string, value: boolean): TomlEdit {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/u);
  const found = scan(lines, table, key);
  const word = String(value);
  if (found.key !== undefined) {
    if (reads(found.key.value, word)) return { ok: true, text: undefined };
    const edited = [...lines];
    edited[found.key.line] = `${found.key.indent}${found.key.written} = ${word}`;
    return { ok: true, text: edited.join(eol) };
  }
  if (found.inline) {
    return { ok: false, problem: `it sets ${table} as an inline table, which teamrig cannot add ${key} to line by line: set ${table}.${key} = ${word} in it by hand` };
  }
  const edited = [...lines];
  if (found.header !== undefined) {
    edited.splice(found.header + 1, 0, `${key} = ${word}`);
  } else if (found.rootDotted !== undefined) {
    edited.splice(found.rootDotted + 1, 0, `${table}.${key} = ${word}`);
  } else {
    const ended = edited.at(-1) === '';
    if (ended) edited.pop();
    const empty = edited.length === 0 || (edited.length === 1 && edited[0] === '');
    return { ok: true, text: [...(empty ? [] : [...edited, '']), `[${table}]`, `${key} = ${word}`, ''].join(eol) };
  }
  return { ok: true, text: edited.join(eol) };
}
