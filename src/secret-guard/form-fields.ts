import { isRecord, type JsonRecord } from '../core/guards.ts';
import { isPlaceholderValue, type SecretShapeHit } from '../core/secret-shapes.ts';

/**
 * A field name or id that marks a password input: `password`, `passwd`, `pwd`, `passcode` or `passphrase`, alone or
 * as one part of a name joined by `-`, `_`, `.` or brackets (`user[password]`, `login-pwd`). A part only has to match
 * whole, so `passenger` or `compass` pass. Wider words (`pass`, `secret`, `otp`) name settings and checks as often as
 * fields, and every place a found value appears is cut, so they mark a field only with its type `password`.
 */
const PASSWORD_NAME = /(?:^|[-_.[\]])(?:pass(?:word|wd|code|phrase)|pwd)(?:$|[-_.[\]])/i;
/** One flat JSON-like object, for text that does not parse as JSON (single quotes, a cut-off dump). */
const OBJECT = /\{[^{}]*\}/g;
const JSON_TYPE_PASSWORD = /"type"\s*:\s*"password"/i;
const JSON_NAME = /"(?:name|id)"\s*:\s*"((?:[^"\\]|\\.)*)"/gi;
const JSON_VALUE = /"value"\s*:\s*"((?:[^"\\]|\\.)*)"/i;
/** Where an `<input ...>` tag of markup starts. */
const INPUT_START = /<input\b/gi;
/** The `type` and `value` attributes by their whole names, so `data-type` or `data-value` is never taken for them. */
const TAG_TYPE_PASSWORD = /(?:^|[\s"'/])type\s*=\s*["']?password\b/i;
const TAG_NAME = /(?:^|[\s"'/])(?:name|id)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const TAG_VALUE = /(?:^|[\s"'/])value\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
/** A `|`-joined record of one input, its tag first: `INPUT|password|id|name|value`. */
const PIPE_RECORD = /^\s*input\|/i;
/** The fields of a full pipe record before its value: the tag, the type, the id and the name. */
const PIPE_HEAD = 4;
/** What a page shows for a hidden value: bullets (stars and repeats are `isPlaceholderValue`'s). */
const MASK = /^[•●·]+$/;

/** Undoes the JSON string escapes a name may hold, to test it as the page has it. */
function jsonText(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(`"${raw}"`);
    return typeof parsed === 'string' ? parsed : raw;
  } catch {
    return raw;
  }
}

/** A JSON string literal, its text as printed (escapes and all). */
const STRING_LITERAL = /"((?:[^"\\]|\\.)*)"/g;

/**
 * The value a page's password field holds, as a form or DOM dump prints it in a tool's result: a `|`-joined input
 * record, a JSON object per input, or `<input>` markup. The value has no shape of its own and sits under the plain key
 * `value`; the field's type (`password`) or a password-like name or id beside it is what marks it. Output-only, like
 * `EnvAssignments`.
 */
export class FormFields {
  /**
   * Every password field's value in `text` as the text prints it, in the order found; an empty, masked or placeholder
   * value passes. A value is named only in a form `text` holds, so each one named is one the redactor can cut.
   */
  hitsIn(text: string): SecretShapeHit[] {
    const values = [...pipeValues(text), ...jsonValues(text), ...tagValues(text)].map((value) => value.trim());
    return [...new Set(values)]
      .filter((value) => isFieldSecret(value) && text.includes(value))
      .map((value) => ({ id: 'form-password', description: 'value of a password field', value }));
  }
}

/**
 * The value of each `INPUT|...` record whose type, name or id marks a password. A full record's value is everything
 * after its four head fields, `|` and all, since a value may hold one; a shorter record's is its last field.
 */
function pipeValues(text: string): string[] {
  return text.split(/\r?\n/).flatMap((line) => {
    if (!PIPE_RECORD.test(line)) return [];
    const fields = line.trim().split('|');
    if (fields.length < 3) return [];
    const head = fields.length > PIPE_HEAD ? fields.slice(1, PIPE_HEAD) : fields.slice(1, -1);
    const marks = head.some((field) => field.toLowerCase() === 'password' || PASSWORD_NAME.test(field));
    if (!marks) return [];
    return [fields.length > PIPE_HEAD ? fields.slice(PIPE_HEAD).join('|') : (fields[fields.length - 1] ?? '')];
  });
}

/**
 * The `value` of each JSON object whose `type` is `password` or whose `name` or `id` marks one. Each balanced
 * `{...}` of the text that parses is walked, nested objects and JSON held as a string included; the rest of the text
 * (a span that does not parse, or objects after a stray `{` that never closes) is read by the flat-object patterns.
 */
function jsonValues(text: string): string[] {
  const found: string[] = [];
  const rest: string[] = [];
  let from = 0;
  for (const [start, end] of objectSpans(text)) {
    const printed = printedValues(text.slice(start, end), 0);
    if (printed === undefined) continue;
    found.push(...printed);
    rest.push(text.slice(from, start));
    from = end;
  }
  rest.push(text.slice(from));
  return [...found, ...flatObjectValues(rest.join(' '))];
}

/**
 * The password values the JSON text `json` holds, each in the forms `json` prints it: the string literal as written
 * (a `\"`, `\\` or `\u` escape kept), so the redactor finds the text the result shows. A value inside JSON held as a
 * string is escaped once more, as the outer string prints it. Undefined when `json` does not parse.
 */
function printedValues(json: string, depth: number): string[] | undefined {
  const parsed = parseJson(json);
  if (parsed === undefined) return undefined;
  const values: string[] = [];
  const held: string[] = [];
  walk(parsed, 0, values, held);
  if (values.length === 0 && held.length === 0) return [];
  const literals = new Map<string, string[]>();
  for (const [, raw = ''] of json.matchAll(STRING_LITERAL)) {
    const text = jsonText(raw);
    literals.set(text, [...(literals.get(text) ?? []), raw]);
  }
  const printed = values.flatMap((value) => [value, ...(literals.get(value) ?? []), escaped(value)]);
  const inner = depth >= MAX_DEPTH ? [] : held.flatMap((string) => printedValues(string, depth + 1) ?? []);
  return [...printed, ...inner.flatMap((value) => [value, escaped(value)])];
}

/** `text` as a JSON string literal holds it, without the quotes. */
function escaped(text: string): string {
  return JSON.stringify(text).slice(1, -1);
}

/** How deep a walk goes into nested objects, arrays and JSON strings: a dump nests a few levels, never hundreds. */
const MAX_DEPTH = 16;

function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Collects the password values a parsed JSON value holds at any depth into `values`, and each string that looks like
 * a JSON object into `held`, to read as JSON of its own.
 */
function walk(node: unknown, depth: number, values: string[], held: string[]): void {
  if (depth > MAX_DEPTH) return;
  if (typeof node === 'string') {
    if (node.trimStart().startsWith('{')) held.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) walk(item, depth + 1, values, held);
    return;
  }
  if (!isRecord(node)) return;
  if (typeof node['value'] === 'string' && marksPassword(node)) values.push(node['value']);
  for (const child of Object.values(node)) walk(child, depth + 1, values, held);
}

function marksPassword(record: JsonRecord): boolean {
  const type = record['type'];
  if (typeof type === 'string' && type.toLowerCase() === 'password') return true;
  return [record['name'], record['id']].some((name) => typeof name === 'string' && PASSWORD_NAME.test(name));
}

/**
 * The start and end of each outermost balanced `{...}` of `text`, a brace inside a JSON string not counted, in one pass. An object left
 * open at the end is not a span.
 */
function objectSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let depth = 0;
  let start = 0;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"' && depth > 0) {
      inString = true;
    } else if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0) spans.push([start, index + 1]);
    }
  }
  return spans;
}

/** The `value` of each flat object in text that is not JSON, by the patterns, as printed and unescaped. */
function flatObjectValues(text: string): string[] {
  return [...text.matchAll(OBJECT)].flatMap(([object]) => {
    const value = JSON_VALUE.exec(object)?.[1];
    if (value === undefined) return [];
    const named = [...object.matchAll(JSON_NAME)].some(([, name = '']) => PASSWORD_NAME.test(jsonText(name)));
    return JSON_TYPE_PASSWORD.test(object) || named ? [value, jsonText(value)] : [];
  });
}

/** The `value` attribute of each `<input>` tag typed `password` or with a password name or id. */
function tagValues(text: string): string[] {
  return inputTags(text).flatMap((tag) => {
    const named = [...tag.matchAll(TAG_NAME)].some((match) => PASSWORD_NAME.test(match[1] ?? match[2] ?? match[3] ?? ''));
    if (!TAG_TYPE_PASSWORD.test(tag) && !named) return [];
    const match = TAG_VALUE.exec(tag);
    const value = match?.[1] ?? match?.[2] ?? match?.[3];
    return value === undefined ? [] : [value];
  });
}

/**
 * Each `<input ...>` tag of `text`, a `>` inside a quoted attribute not ending it. A tag left open by a quote that
 * never closes ends at its first `>` instead, and so does every later one, so a long result is read in one pass
 * rather than once per tag start.
 */
function inputTags(text: string): string[] {
  const tags: string[] = [];
  let quoteAware = true;
  INPUT_START.lastIndex = 0;
  for (let start = INPUT_START.exec(text); start !== null; start = INPUT_START.exec(text)) {
    const end = quoteAware ? quotedTagEnd(text, start.index) : text.indexOf('>', start.index);
    if (end === -1 && quoteAware) {
      quoteAware = false;
      INPUT_START.lastIndex = start.index;
      continue;
    }
    if (end === -1) break;
    tags.push(text.slice(start.index, end + 1));
    INPUT_START.lastIndex = end + 1;
  }
  return tags;
}

/** The index of the `>` that ends the tag at `start`, skipping quoted attribute values; -1 when none does. */
function quotedTagEnd(text: string, start: number): number {
  let quote: string | undefined;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index;
    }
  }
  return -1;
}

/**
 * True when a password field's value is one to hide: not a mask and not a placeholder. Every place a found value
 * appears is replaced, so `isPlaceholderValue`'s floor on length also keeps a short value from cutting up the result.
 */
function isFieldSecret(value: string): boolean {
  return !MASK.test(value) && !isPlaceholderValue(value);
}
