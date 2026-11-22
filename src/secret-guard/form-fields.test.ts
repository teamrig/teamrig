import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FormFields } from './form-fields.ts';
import { ToolOutputRedactor } from './redactor.ts';

const join = (...parts: string[]): string => parts.join('');
const PASSWORD = join('s3', 'cret', 'Value9');
const fields = new FormFields();
const values = (text: string): string[] => fields.hitsIn(text).map(({ value }) => value);
/** The stdout a redaction by these fields alone leaves, and the kinds it reports. */
const redacted = (stdout: string): { stdout: unknown; classes: readonly string[] } => {
  const redaction = new ToolOutputRedactor([fields]).redact({ stdout });
  return { stdout: redaction.response['stdout'], classes: redaction.classes };
};

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
    assert.deepEqual(values(join('{"type":"text","name":"login_pwd","value":"', PASSWORD, '"}')), [PASSWORD]);
  });

  it('finds the value attribute of password input markup', () => {
    assert.deepEqual(values(join('<form><input name="u" value="carl"><input type="password" name="p" value="', PASSWORD, '"></form>')), [PASSWORD]);
    assert.deepEqual(values(join("<INPUT value='", PASSWORD, "' TYPE=password>")), [PASSWORD]);
  });

  it('takes the whole value when it holds a pipe, a brace or a >', () => {
    assert.deepEqual(values(join('INPUT|password|pw|pass|ab|', PASSWORD)), [join('ab|', PASSWORD)]);
    assert.deepEqual(values(join('{"type":"password","value":"ab}', PASSWORD, '"}')), [join('ab}', PASSWORD)]);
    assert.deepEqual(values(join('{"type":"password","value":"ab{', PASSWORD, '"}')), [join('ab{', PASSWORD)]);
    assert.deepEqual(values(join('<input type="password" value="ab>', PASSWORD, '">')), [join('ab>', PASSWORD)]);
  });

  it('reads nested objects, JSON held as a string, and objects after a stray brace', () => {
    assert.deepEqual(values(join('{"type":"password","attrs":{"a":1},"value":"', PASSWORD, '"}')), [PASSWORD]);
    assert.deepEqual(values(join('{"fields":[{"input":{"name":"pwd","value":"', PASSWORD, '"}}]}')), [PASSWORD]);
    assert.deepEqual(values(join('{"out":"{\\"type\\":\\"password\\",\\"value\\":\\"', PASSWORD, '\\"}"}')), [PASSWORD]);
    assert.deepEqual(values(join('a { opens here\n{"type":"password","value":"', PASSWORD, '"}')), [PASSWORD]);
    assert.deepEqual(values(join("{'type':'password'} {\"type\":\"password\",\"value\":\"", PASSWORD, '"}')), [PASSWORD]);
  });

  it('takes a camelCase password name as a part', () => {
    for (const name of ['newPassword', 'confirmPassword', 'passwordConfirm', 'userPwd', 'passWord', 'PassWord', 'passCode', 'PassPhrase', 'passWd', 'user[passWord]', 'login-passCode', 'newPassCode', 'URLPassword']) {
      assert.deepEqual(values(join('{"type":"text","name":"', name, '","value":"', PASSWORD, '"}')), [PASSWORD], name);
      assert.deepEqual(values(join('<input type=text id="', name, '" value="', PASSWORD, '">')), [PASSWORD], name);
      assert.deepEqual(values(join('INPUT|text|', name, '|f|', PASSWORD)), [PASSWORD], name);
    }
  });

  it('cuts a value holding a JSON escape as the result prints it', () => {
    for (const raw of [join('a\\"', PASSWORD), join('a\\\\', PASSWORD), join('\\u0041', PASSWORD)]) {
      const result = redacted(join('{"type":"password","value":"', raw, '"}'));
      assert.deepEqual(result, { stdout: '{"type":"password","value":"[redacted value of a password field]"}', classes: ['value of a password field'] }, raw);
    }
    const held = redacted(join('{"out":"{\\"type\\":\\"password\\",\\"value\\":\\"a\\\\\\"', PASSWORD, '\\"}"}'));
    assert.ok(!String(held.stdout).includes(PASSWORD), String(held.stdout));
  });

  it('takes a password-named input tag of any type', () => {
    assert.deepEqual(values(join('<input type=text name="user[password]" value="', PASSWORD, '">')), [PASSWORD]);
  });

  it('takes the attribute named value or type, never a data- attribute first', () => {
    assert.deepEqual(values(join('<input type=password data-value="x" value="', PASSWORD, '">')), [PASSWORD]);
    assert.deepEqual(values(join('<input data-type="password" type="text" value="', PASSWORD, '">')), []);
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
      join('{"type":"text","name":"Passenger","value":"', PASSWORD, '"}'),
      join('{"type":"text","name":"myCompass","value":"', PASSWORD, '"}'),
      join('<input type="text" value="', PASSWORD, '">'),
      join('| password | ', PASSWORD, ' |'),
      join('the password field holds ', PASSWORD),
      '{"type":"password","name":"p"}',
      join('{"id":"secret-guard","value":"', PASSWORD, '"}'),
      join('{"name":"pass","value":"', PASSWORD, '"}'),
      join('{"type":"text","name":"otp","value":"', PASSWORD, '"}'),
    ];
    for (const text of plain) {
      assert.deepEqual(values(text), [], text);
    }
  });
});
