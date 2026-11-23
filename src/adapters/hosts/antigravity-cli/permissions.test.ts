import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { antigravityPermissions } from './permissions.ts';

describe('antigravityPermissions', () => {
  it('names permissions.allow and permissions.deny', () => {
    assert.equal(antigravityPermissions.allowSetting, 'permissions.allow');
    assert.equal(antigravityPermissions.denySetting, 'permissions.deny');
  });

  it('reads allow, deny, and bypassPermissions from settings and refuses malformed shapes', () => {
    assert.deepEqual(antigravityPermissions.read({}), { allow: { ok: true, value: [] }, deny: [], bypass: undefined });
    assert.deepEqual(
      antigravityPermissions.read({ permissions: { allow: ['command(git *)'], deny: ['read_file(.env)', 42], defaultMode: 'bypassPermissions' } }),
      { allow: { ok: true, value: ['command(git *)'] }, deny: ['read_file(.env)'], bypass: 'permissions.defaultMode is bypassPermissions' },
    );
    assert.deepEqual(antigravityPermissions.read({ permissions: [] }).allow, { ok: false, problem: 'permissions is not an object' });
    assert.deepEqual(antigravityPermissions.read({ permissions: { allow: [1] } }).allow, { ok: false, problem: 'permissions.allow is not a list of texts' });
  });

  it('writes allow while preserving other settings and refuses non-object permissions', () => {
    assert.deepEqual(
      antigravityPermissions.writeAllow({ theme: 'dark', permissions: { deny: ['read_file(.env)'] } }, ['command(npm test *)']),
      { ok: true, value: { theme: 'dark', permissions: { deny: ['read_file(.env)'], allow: ['command(npm test *)'] } } },
    );
    assert.deepEqual(antigravityPermissions.writeAllow({ permissions: 'bad' }, []), { ok: false, problem: 'permissions is not an object' });
  });

  it('produces platform-specific denyLines, command() prefixAllowRules, and refuses routes', () => {
    assert.equal(antigravityPermissions.denyLines('win32').includes('read_file(~/AppData/Roaming/GitHub CLI/hosts.yml)'), true);
    assert.equal(antigravityPermissions.denyLines('linux').includes('read_file(~/.config/gh/hosts.yml)'), true);
    assert.deepEqual(antigravityPermissions.prefixAllowRules('teamrig list'), ['command(teamrig list *)']);
    assert.equal(antigravityPermissions.installRoutes({}, 'tag:', ['a']).ok, false);
    assert.equal(antigravityPermissions.uninstallRoutes({}, 'tag:').ok, false);
  });
});
