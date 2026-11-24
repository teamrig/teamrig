import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withBooleanKey, withBooleanKeyInEach, type TomlEdit } from './config-toml.ts';

function off(text: string): TomlEdit {
  return withBooleanKey(text, 'features', 'unified_exec_tty', false);
}

function edited(text: string): string {
  const answer = off(text);
  assert.ok(answer.ok, JSON.stringify(answer));
  assert.notEqual(answer.text, undefined, 'the text changes');
  return answer.text ?? '';
}

const TRUST = ['[hooks.state]', '"abc123" = { trusted = true }', ''].join('\n');

describe("Codex CLI's config.toml: one boolean key set by lines", () => {
  it('writes a new table into an empty or missing file', () => {
    assert.equal(edited(''), '[features]\nunified_exec_tty = false\n');
  });

  it("appends the table after the person's lines, keeping each of them and the hooks trust", () => {
    const text = ['# mine', 'model = "gpt-5"', '', TRUST].join('\n');
    assert.equal(edited(text), `${text}\n[features]\nunified_exec_tty = false\n`);
    assert.equal(edited('model = "gpt-5"'), 'model = "gpt-5"\n\n[features]\nunified_exec_tty = false\n');
  });

  it('adds the key right under an existing [features] header, other keys kept', () => {
    const text = ['model = "m"', '[features]', 'web_search = true', TRUST].join('\n');
    assert.equal(edited(text), ['model = "m"', '[features]', 'unified_exec_tty = false', 'web_search = true', TRUST].join('\n'));
  });

  it('turns the key off where it is on, keeping its indent and how its key was written', () => {
    assert.equal(edited('[features]\n  unified_exec_tty = true # on\n'), '[features]\n  unified_exec_tty = false\n');
    assert.equal(edited('[ features ]\n"unified_exec_tty"=true\n'), '[ features ]\n"unified_exec_tty" = false\n');
    assert.equal(edited('features.unified_exec_tty = true\n[other]\n'), 'features.unified_exec_tty = false\n[other]\n');
  });

  it('changes nothing when the key is already off', () => {
    assert.deepEqual(off('[features]\nunified_exec_tty = false\n'), { ok: true, text: undefined });
    assert.deepEqual(off('[features]\nunified_exec_tty = false # teamrig\n'), { ok: true, text: undefined });
    assert.deepEqual(off('features . unified_exec_tty = false\n'), { ok: true, text: undefined });
  });

  it('adds a root dotted key beside the root dotted keys already into the table, never a second table', () => {
    assert.equal(edited('features.web_search = true\n[other]\nx = 1\n'), 'features.web_search = true\nfeatures.unified_exec_tty = false\n[other]\nx = 1\n');
  });

  it('reads no key or header inside a multi-line string, nor a same-named key of another table', () => {
    const text = ['notes = """', '[features]', 'unified_exec_tty = false', '"""', '[profiles.x.features]', 'unified_exec_tty = true', ''].join('\n');
    assert.equal(edited(text), `${text}\n[features]\nunified_exec_tty = false\n`);
    assert.equal(edited("a = '''one line'''\n"), "a = '''one line'''\n\n[features]\nunified_exec_tty = false\n");
  });

  it('keeps the file\'s CRLF line ends', () => {
    assert.equal(edited('model = "m"\r\n'), 'model = "m"\r\n\r\n[features]\r\nunified_exec_tty = false\r\n');
  });

  it('skips an array of tables, so its keys never read as the table\'s', () => {
    assert.equal(edited('[[profiles]]\nfeatures.unified_exec_tty = false\n'), '[[profiles]]\nfeatures.unified_exec_tty = false\n\n[features]\nunified_exec_tty = false\n');
  });

  it('refuses an inline table, which it cannot add a key to line by line', () => {
    const answer = off('features = { web_search = true }\n');
    assert.equal(answer.ok, false);
    assert.match(answer.ok ? '' : answer.problem, /inline table.*set features\.unified_exec_tty = false in it by hand/);
  });
});

function profilesOff(text: string): TomlEdit {
  return withBooleanKeyInEach(text, 'profiles', 'features.unified_exec_tty', false);
}

function profilesEdited(text: string): string {
  const answer = profilesOff(text);
  assert.ok(answer.ok, JSON.stringify(answer));
  assert.notEqual(answer.text, undefined, 'the text changes');
  return answer.text ?? '';
}

describe("Codex CLI's config.toml: a boolean key set in each named profile", () => {
  it('turns the key off in every profile that turns it on, however the key is written', () => {
    const text = [
      '[features]',
      'unified_exec_tty = false',
      '[profiles.fast.features]',
      'unified_exec_tty = true # mine',
      '[profiles."deep work"]',
      'model = "m"',
      '  features.unified_exec_tty = true',
      'profiles.root.features.unified_exec_tty = true',
      TRUST,
    ].join('\n');
    assert.equal(
      profilesEdited(text),
      [
        '[features]',
        'unified_exec_tty = false',
        '[profiles.fast.features]',
        'unified_exec_tty = false',
        '[profiles."deep work"]',
        'model = "m"',
        '  features.unified_exec_tty = false',
        'profiles.root.features.unified_exec_tty = false',
        TRUST,
      ].join('\n'),
    );
  });

  it('adds nothing and changes nothing when no profile turns the key on', () => {
    for (const text of ['', '[profiles.fast]\nmodel = "m"\n', '[profiles.fast.features]\nunified_exec_tty = false\n', '[features]\nunified_exec_tty = true\n']) {
      assert.deepEqual(profilesOff(text), { ok: true, text: undefined }, text);
    }
  });

  it("leaves another table's same-named key, a key inside a multi-line string and an array of tables as they are", () => {
    const text = ['[other.fast.features]', 'unified_exec_tty = true', 'note = """', '[profiles.x.features]', 'unified_exec_tty = true', '"""', '[[profiles]]', 'features.unified_exec_tty = true', ''].join('\n');
    assert.deepEqual(profilesOff(text), { ok: true, text: undefined });
  });

  it('keeps the CRLF line ends', () => {
    assert.equal(profilesEdited('[profiles.a.features]\r\nunified_exec_tty = true\r\n'), '[profiles.a.features]\r\nunified_exec_tty = false\r\n');
  });

  it('refuses an inline table under the profiles that may hold the key, and passes one that cannot', () => {
    for (const text of ['[profiles.a]\nfeatures = { unified_exec_tty = true }\n', 'profiles = { a = { features = { unified_exec_tty = true } } }\n']) {
      const answer = profilesOff(text);
      assert.equal(answer.ok, false, text);
      assert.match(answer.ok ? '' : answer.problem, /inline table that may hold unified_exec_tty/u);
    }
    assert.deepEqual(profilesOff('[profiles.a]\nmodel_providers = { x = 1 }\n'), { ok: true, text: undefined });
  });
});
