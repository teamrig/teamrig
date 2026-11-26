import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JcsError, jcs } from './jcs.ts';

describe('jcs (RFC 8785)', () => {
  it('gives the RFC 8785 section 3.2.2 example its exact text', () => {
    const value = {
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      // The RFC's input: € $ U+000F LF A ' B " then two backslashes, " and /.
      string: `€$\u000F\nA'B"${'\\'.repeat(2)}"/`,
      literals: [null, true, false],
    };
    assert.equal(
      jcs(value),
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts keys by UTF-16 code units, as the RFC 8785 section 3.2.3 example does', () => {
    const value: Readonly<Record<string, string>> = {
      '€': 'Euro Sign',
      '\r': 'Carriage Return',
      'דּ': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '😀': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      'ö': 'Latin Small Letter O With Diaeresis',
    };
    // Read from the text: a parsed object lists an integer-like key such as "1" first whatever the text's order.
    const order = ['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ'];
    const expected = `{${order.map((key) => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(',')}}`;
    assert.equal(jcs(value), expected);
  });

  it('prints the RFC 8785 appendix B numbers as ECMAScript does', () => {
    const cases: readonly (readonly [number, string])[] = [
      [0, '0'],
      [-0, '0'],
      [5e-324, '5e-324'],
      [1.7976931348623157e308, '1.7976931348623157e+308'],
      [9007199254740992, '9007199254740992'],
      [1e21, '1e+21'],
      [9.999999999999997e22, '9.999999999999997e+22'],
      [0.000001, '0.000001'],
      [9.999999999999997e-7, '9.999999999999997e-7'],
    ];
    for (const [number, expected] of cases) assert.equal(jcs(number), expected);
  });

  it('sorts nested objects too and keeps array order', () => {
    assert.equal(jcs({ b: [{ z: 1, a: 2 }, 'x'], a: { d: null, c: false } }), '{"a":{"c":false,"d":null},"b":[{"a":2,"z":1},"x"]}');
  });

  it('refuses a number JSON cannot hold', () => {
    for (const number of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(() => jcs([number]), JcsError);
    }
  });

  it('refuses a lone surrogate in a value or a key', () => {
    assert.throws(() => jcs('\ud83d'), JcsError);
    assert.throws(() => jcs('\ude00x'), JcsError);
    assert.throws(() => jcs({ '\ud83d': 1 }), JcsError);
  });
});
