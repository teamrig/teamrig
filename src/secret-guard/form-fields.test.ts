import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FormFields } from './form-fields.ts';

const join = (...parts: string[]): string => parts.join('');
const PASSWORD = join('s3', 'cret', 'Value9');
const fields = new FormFields();
const values = (text: string): string[] => fields.hitsIn(text).map(({ value }) => value);

describe('FormFields', () => {
  it("finds a password field's value in a pipe-joined input record", () => {
    assert.deepEqual(fields.hitsIn(join('INPUT|text|user|login|carl\nINPUT|password|pw|pass|', PASSWORD, '\n')), [
      { id: 'form-password', description: 'value of a password field', value: PASSWORD },
    ]);
    assert.deepEqual(values(join('input|text|login-pwd|pwd|', PASSWORD)), [PASSWORD]);
  });

  it("finds a password field's value in a JSON object per input, by its type or a password-like name or id", () => {
    assert.deepEqual(values(join('[{"type":"text","name":"user","value":"carl"},{"type":"password","name":"p","value":"', PASSWORD, '"}]')), [PASSWORD]);
    assert.deepEqual(values(join('{"value": "', PASSWORD, '", "id": "user[password]"}')), [PASSWORD]);
    assert.deepEqual(values(join('{"type":"text","name":"otp","value":"', PASSWORD, '"}')), [PASSWORD]);
    assert.deepEqual(values(join('{"type":"password","value":"a\\"', PASSWORD, '"}')), [join('a"', PASSWORD)]);
  });

  it('finds the value attribute of password input markup', () => {
    assert.deepEqual(values(join('<form><input name="u" value="carl"><input type="password" name="p" value="', PASSWORD, '"></form>')), [PASSWORD]);
    assert.deepEqual(values(join("<INPUT value='", PASSWORD, "' TYPE=password>")), [PASSWORD]);
  });

  it('passes an empty, masked, short or placeholder value', () => {
    for (const value of ['', '••••••••', '********', 'abc', 'password', 'changeme', '${PASSWORD}']) {
      const text = join('INPUT|password|pw|pass|', value, '\n{"type":"password","value":"', value, '"}\n<input type="password" value="', value, '">');
      assert.deepEqual(values(text), [], value);
    }
  });

  it('passes fields that only look alike: other types and names, a name that merely contains pass, prose and tables', () => {
    const plain = [
      join('INPUT|text|user|login|', PASSWORD),
      join('{"type":"text","name":"passenger","value":"', PASSWORD, '"}'),
      join('{"type":"email","id":"compass","value":"', PASSWORD, '"}'),
      join('<input type="text" value="', PASSWORD, '">'),
      join('| password | ', PASSWORD, ' |'),
      join('the password field holds ', PASSWORD),
      '{"type":"password","name":"p"}',
    ];
    for (const text of plain) {
      assert.deepEqual(values(text), [], text);
    }
  });
});
