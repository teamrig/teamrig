import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveOf, observedPermission, type MappedPermissionMode } from './permission-mode.ts';

const TABLE: Readonly<Record<string, MappedPermissionMode>> = { default: 'ask', bypassPermissions: 'bypass' };

describe("a host's permission-mode word", () => {
  it("maps by the adapter's table, keeping the host's word", () => {
    assert.deepEqual(observedPermission('default', TABLE), { mode: 'ask', hostWord: 'default' });
    assert.deepEqual(observedPermission('bypassPermissions', TABLE), { mode: 'bypass', hostWord: 'bypassPermissions' });
  });

  it('is unmapped for another case, a prefix, a longer word or an inherited key, never the mode it resembles', () => {
    for (const word of ['Default', 'DEFAULT', 'def', 'defaultMode', 'bypass', 'toString', 'constructor', '__proto__', '']) {
      assert.deepEqual(observedPermission(word, TABLE), { mode: 'unmapped', hostWord: word }, word);
    }
  });
});

describe('the effective config of a hook call', () => {
  it('reports each field the hook input told as known from the hook input', () => {
    const permission = { mode: 'ask', hostWord: 'default' } as const;
    assert.deepEqual(effectiveOf({ model: 'claude-opus-5-5', effort: 'high', permission }), {
      model: { known: true, value: 'claude-opus-5-5', source: 'hook-input' },
      effort: { known: true, value: 'high', source: 'hook-input' },
      permissionMode: { known: true, value: permission, source: 'hook-input' },
    });
  });

  it('reports a field the hook input left out as not told, never a value of its own', () => {
    const untold = { known: false, why: 'not-told' } as const;
    assert.deepEqual(effectiveOf({ model: undefined, effort: undefined, permission: undefined }), { model: untold, effort: untold, permissionMode: untold });
  });
});
