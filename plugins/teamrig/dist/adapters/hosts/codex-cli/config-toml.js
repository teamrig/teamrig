/**
 * Sets one boolean key in Codex CLI's `config.toml` by editing lines, so every other line, comment and table (the
 * person's settings, and the `[hooks.state]` trust Codex keeps there) stays exactly as it was. teamrig ships no TOML
 * library, and a parse and rewrite would drop the person's comments and layout.
 *
 * It reads the TOML the key can sit in: under its `[table]` header, as a dotted key at the root (`table.key = ...`),
 * with bare or quoted key words, beside multi-line strings that may hold lines looking like headers. An inline table
 * (`table = { ... }`) is refused, as the key cannot be added to it line by line.
 */
const HEADER = /^\s*\[\s*([^[\]]+?)\s*\]\s*(?:#.*)?$/u;
const ARRAY_HEADER = /^\s*\[\[/u;
const KEY_LINE = /^(\s*)((?:[A-Za-z0-9_-]+|"[^"\n]*"|'[^'\n]*')(?:\s*\.\s*(?:[A-Za-z0-9_-]+|"[^"\n]*"|'[^'\n]*'))*)\s*=\s*(.*)$/u;
const KEY_WORD = /[A-Za-z0-9_-]+|"[^"\n]*"|'[^'\n]*'/gu;
const DELIMITERS = ['"""', "'''"];
/** A dotted key's words, unquoted: `a."b".c` is `a.b.c`. */
function keyPath(written) {
    return (written.match(KEY_WORD) ?? []).map((word) => (word.startsWith('"') || word.startsWith("'") ? word.slice(1, -1) : word)).join('.');
}
function count(line, delimiter) {
    return line.split(delimiter).length - 1;
}
/** The multi-line string still open after `line`, given the one open before it. */
function openAfter(line, open) {
    if (open !== undefined) {
        return count(line, open) % 2 === 1 ? undefined : open;
    }
    return DELIMITERS.find((delimiter) => count(line, delimiter) % 2 === 1);
}
function scan(lines, table, key) {
    const found = { header: undefined, rootDotted: undefined, firstHeader: undefined, key: undefined, inline: false };
    const target = `${table}.${key}`;
    let current = '';
    let open;
    lines.forEach((line, index) => {
        if (open !== undefined) {
            open = openAfter(line, open);
            return;
        }
        const header = ARRAY_HEADER.test(line) ? undefined : HEADER.exec(line);
        if (ARRAY_HEADER.test(line) || header !== null) {
            found.firstHeader ??= index;
            current = header?.[1] === undefined ? '[[array]]' : keyPath(header[1]);
            if (current === table)
                found.header ??= index;
            return;
        }
        const pair = KEY_LINE.exec(line);
        if (pair !== null) {
            const [, indent = '', written = '', value = ''] = pair;
            const path = current === '' ? keyPath(written) : `${current}.${keyPath(written)}`;
            if (path === target)
                found.key ??= { line: index, indent, written, value };
            if (current === '' && path === table && value.trimStart().startsWith('{'))
                found.inline = true;
            if (current === '' && path.startsWith(`${table}.`))
                found.rootDotted ??= index;
        }
        open = openAfter(line, undefined);
    });
    return found;
}
/** `text` with `table.key` set to `value`, every other line kept. */
export function withBooleanKey(text, table, key, value) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/u);
    const found = scan(lines, table, key);
    const word = String(value);
    if (found.key !== undefined) {
        if (new RegExp(`^${word}(?:\\s|#|$)`, 'u').test(found.key.value))
            return { ok: true, text: undefined };
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
    }
    else if (found.rootDotted !== undefined) {
        edited.splice(found.rootDotted + 1, 0, `${table}.${key} = ${word}`);
    }
    else {
        const ended = edited.at(-1) === '';
        if (ended)
            edited.pop();
        const empty = edited.length === 0 || (edited.length === 1 && edited[0] === '');
        return { ok: true, text: [...(empty ? [] : [...edited, '']), `[${table}]`, `${key} = ${word}`, ''].join(eol) };
    }
    return { ok: true, text: edited.join(eol) };
}
