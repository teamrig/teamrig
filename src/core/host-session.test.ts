import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_SESSION_FIELD, hostSessionOf, hostSessionValue, isHostSessionId, legacyHostSessionRecord } from './host-session.ts';

const TAB = '0a1b2c3d-1111-2222-3333-444455556666';
const OTHER_TAB = '9f8e7d6c-1111-2222-3333-444455556666';

describe('hostSessionOf', () => {
  it('reads the session from the new field, and from the old field of a record written before the rename', () => {
    assert.equal(HOST_SESSION_FIELD, 'hostSession');
    assert.equal(hostSessionOf({ hostSession: TAB }, 'claudeSession'), TAB);
    assert.equal(hostSessionOf({ claudeSession: TAB }, 'claudeSession'), TAB);
    assert.equal(hostSessionOf({ claude: TAB }, 'claude'), TAB);
  });

  it('reads only the old field its store used', () => {
    assert.equal(hostSessionOf({ claude: TAB }, 'claudeSession'), undefined);
    assert.equal(hostSessionOf({ claudeSession: TAB }, 'claude'), undefined);
  });

  it('takes the new field over the old one, a null included', () => {
    assert.equal(hostSessionOf({ hostSession: TAB, claudeSession: OTHER_TAB }, 'claudeSession'), TAB);
    assert.equal(hostSessionOf({ hostSession: null, claudeSession: OTHER_TAB }, 'claudeSession'), undefined);
  });

  it('names no session for a record with none, or with one that is not text', () => {
    assert.equal(hostSessionOf({}, 'claudeSession'), undefined);
    assert.equal(hostSessionOf({ hostSession: 7 }, 'claudeSession'), undefined);
    assert.equal(hostSessionOf({ claudeSession: null }, 'claudeSession'), undefined);
  });
});

describe('isHostSessionId', () => {
  it('takes a UUID, as Claude Code and Codex give, and an id of another host that is no UUID', () => {
    assert.equal(isHostSessionId(TAB), true);
    assert.equal(isHostSessionId('session-1'), true);
    assert.equal(isHostSessionId('A_b-9'), true);
    assert.equal(isHostSessionId('a'.repeat(128)), true);
  });

  it('refuses an id unsafe as a file name or an argument', () => {
    for (const unsafe of ['', '-resume', '_x', '../x', 'a/b', 'a\\b', 'a.b', 'a b', 'a\nb', 'a'.repeat(129), 'nul', 'CON', 'com1', 'Lpt9']) {
      assert.equal(isHostSessionId(unsafe), false, JSON.stringify(unsafe));
    }
  });

  it('takes a name that only starts like a device name', () => {
    assert.equal(isHostSessionId('console'), true);
    assert.equal(isHostSessionId('com10'), true);
  });
});

describe('hostSessionValue', () => {
  it('hands back what the record stores, unchecked', () => {
    assert.equal(hostSessionValue({ hostSession: null, claudeSession: TAB }, 'claudeSession'), null);
    assert.equal(hostSessionValue({ claudeSession: null }, 'claudeSession'), null);
    assert.equal(hostSessionValue({ hostSession: 7 }, 'claudeSession'), 7);
    assert.equal(hostSessionValue({}, 'claudeSession'), undefined);
  });
});

describe('legacyHostSessionRecord', () => {
  it('writes the session under the old field in the same place, so the stored line keeps its bytes', () => {
    const record = { v: 1, area: 'alpha', hostSession: TAB, lastLineHash: null };
    const stored = legacyHostSessionRecord(record, 'claudeSession');
    assert.equal(JSON.stringify(stored), `{"v":1,"area":"alpha","claudeSession":"${TAB}","lastLineHash":null}`);
    assert.deepEqual(record, { v: 1, area: 'alpha', hostSession: TAB, lastLineHash: null }, 'the input stays as it was');
  });

  it('keeps a null session, and leaves a record without one as it is', () => {
    assert.deepEqual(legacyHostSessionRecord({ hostSession: null, at: 'x' }, 'claudeSession'), { claudeSession: null, at: 'x' });
    assert.deepEqual(legacyHostSessionRecord({ at: 'x', other: OTHER_TAB }, 'claudeSession'), { at: 'x', other: OTHER_TAB });
  });
});
