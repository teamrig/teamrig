import { isPlaceholderValue, type SecretShapeHit } from '../core/secret-shapes.ts';

/**
 * A field name or id that marks a password-like input: `password`, `passwd`, `pass`, `pwd`, `passcode`, `passphrase`,
 * `otp`, `secret`, alone or as one part of a name joined by `-`, `_`, `.` or brackets (`user[password]`,
 * `login-pwd`). A part only has to match whole, so `passenger` or `compass` pass.
 */
const PASSWORD_NAME = /(?:^|[-_.[\]])(?:pass(?:word|wd|code|phrase)?|pwd|otp|secret)(?:$|[-_.[\]])/i;
/** One flat JSON-like object: the record a DOM read prints for each input. */
const OBJECT = /\{[^{}]*\}/g;
const JSON_TYPE_PASSWORD = /"type"\s*:\s*"password"/i;
const JSON_NAME = /"(?:name|id)"\s*:\s*"((?:[^"\\]|\\.)*)"/gi;
const JSON_VALUE = /"value"\s*:\s*"((?:[^"\\]|\\.)*)"/i;
/** One `<input ...>` tag of markup. */
const INPUT_TAG = /<input\b[^>]*>/gi;
const TAG_TYPE_PASSWORD = /\btype\s*=\s*["']?password\b/i;
const TAG_VALUE = /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
/** A `|`-joined record of one input, its tag first: `INPUT|password|id|name|value`. */
const PIPE_RECORD = /^\s*input\|/i;
/** What a page shows for a hidden value: bullets (stars and repeats are `isPlaceholderValue`'s). */
const MASK = /^[•●·]+$/;

/** Undoes the JSON string escapes a record's value may hold, so the text replaced is the text the result shows. */
function jsonText(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

/**
 * The value a page's password field holds, as a form or DOM dump prints it in a tool's result: a `|`-joined input
 * record, a JSON object per input, or `<input>` markup. The value has no shape of its own and sits under the plain key
 * `value`; the field's type (`password`) or a password-like name or id beside it is what marks it. Output-only, like
 * `EnvAssignments`.
 */
export class FormFields {
  /** Every password field's value in `text`, in the order found; an empty, masked or placeholder value passes. */
  hitsIn(text: string): SecretShapeHit[] {
    const values = [...pipeValues(text), ...jsonValues(text), ...tagValues(text)];
    return values
      .map((value) => value.trim())
      .filter(isFieldSecret)
      .map((value) => ({ id: 'form-password', description: 'value of a password field', value }));
  }
}

/** The last field of each `INPUT|...` record whose type, name or id marks a password. */
function pipeValues(text: string): string[] {
  return text.split(/\r?\n/).flatMap((line) => {
    if (!PIPE_RECORD.test(line)) return [];
    const fields = line.trim().split('|');
    if (fields.length < 3) return [];
    const marks = fields.slice(1, -1).some((field) => field.toLowerCase() === 'password' || PASSWORD_NAME.test(field));
    return marks ? [fields[fields.length - 1] ?? ''] : [];
  });
}

/** The `value` of each flat JSON object whose `type` is `password` or whose `name` or `id` marks one. */
function jsonValues(text: string): string[] {
  return [...text.matchAll(OBJECT)].flatMap(([object]) => {
    const value = JSON_VALUE.exec(object)?.[1];
    if (value === undefined) return [];
    const named = [...object.matchAll(JSON_NAME)].some(([, name = '']) => PASSWORD_NAME.test(jsonText(name)));
    return JSON_TYPE_PASSWORD.test(object) || named ? [jsonText(value)] : [];
  });
}

/** The `value` attribute of each `<input type="password">` tag. */
function tagValues(text: string): string[] {
  return [...text.matchAll(INPUT_TAG)].flatMap(([tag]) => {
    if (!TAG_TYPE_PASSWORD.test(tag)) return [];
    const match = TAG_VALUE.exec(tag);
    const value = match?.[1] ?? match?.[2] ?? match?.[3];
    return value === undefined ? [] : [value];
  });
}

/**
 * True when a password field's value is one to hide: not a mask and not a placeholder. Every place a found value
 * appears is replaced, so `isPlaceholderValue`'s floor on length also keeps a short value from cutting up the result.
 */
function isFieldSecret(value: string): boolean {
  return !MASK.test(value) && !isPlaceholderValue(value);
}
