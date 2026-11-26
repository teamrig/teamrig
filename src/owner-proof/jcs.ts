/** A JSON value as RFC 8785 serializes it: no undefined, no functions, no non-finite numbers. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Why a value has no RFC 8785 text: a number JSON cannot hold, or a string that is not well-formed UTF-16. */
export class JcsError extends Error {}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

function byCodeUnits(left: string, right: string): number {
  // RFC 8785 3.2.3: keys sort by their UTF-16 code units, which is what < compares on JavaScript strings. An object's
  // keys are unique, so two are never equal.
  return left < right ? -1 : 1;
}

function text(value: string): string {
  if (LONE_SURROGATE.test(value)) throw new JcsError('a string holds a lone surrogate, which RFC 8785 refuses');
  // RFC 8785 3.2.2 (strings) escapes exactly as ECMAScript's JSON.stringify does for well-formed strings.
  return JSON.stringify(value);
}

function isArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/**
 * The RFC 8785 (JSON Canonicalization Scheme) text of `value`: object keys sorted by UTF-16 code units at every depth,
 * no spacing, numbers as ECMAScript prints them, strings as JSON.stringify escapes them. One value always gives one
 * text, so a hash of it binds the value (the owner's proof challenge, T4758). Throws JcsError for a non-finite number
 * or a lone surrogate, which have no canonical form.
 */
export function jcs(value: JsonValue): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new JcsError(`the number ${String(value)} has no JSON form`);
    // RFC 8785 3.2.2 (numbers) is ECMAScript's Number serialization; -0 prints as 0 there too.
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return text(value);
  if (isArray(value)) return `[${value.map(jcs).join(',')}]`;
  const entries = Object.entries(value).sort(([left], [right]) => byCodeUnits(left, right));
  return `{${entries.map(([key, item]) => `${text(key)}:${jcs(item)}`).join(',')}}`;
}
