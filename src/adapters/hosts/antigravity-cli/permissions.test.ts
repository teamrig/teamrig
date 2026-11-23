import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { antigravityPermissions } from './permissions.ts';

describe('antigravityPermissions', () => {
  it('names permissions.allow, permissions.deny, and no routes setting', () => {
    assert.equal(antigravityPermissions.allowSetting, 'permissions.allow');
    assert.equal(antigravityPermissions.denySetting, 'permissions.deny');
    assert.equal(antigravityPermissions.routesSetting, 'none (Antigravity CLI has no routes setting)');
  });

  it('reads allow, deny, and toolPermission bypass from settings and refuses malformed shapes', () => {
    assert.deepEqual(antigravityPermissions.read({}), { allow: { ok: true, value: [] }, deny: [], bypass: undefined });
    assert.deepEqual(
      antigravityPermissions.read({ toolPermission: 'always-proceed', permissions: { allow: ['command(git *)'], deny: ['read_file(.env)', 42] } }),
      { allow: { ok: true, value: ['command(git *)'] }, deny: ['read_file(.env)'], bypass: 'toolPermission is always-proceed' },
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

  it('produces platform-specific denyLines including Windows shells, command() prefixAllowRules, and refuses routes', () => {
    const winLines = antigravityPermissions.denyLines('win32');
    assert.equal(winLines.includes('read_file(~/AppData/Roaming/GitHub CLI/hosts.yml)'), true);
    assert.equal(winLines.includes('command(set)'), true);
    assert.equal(winLines.includes('command(Get-ChildItem env*)'), true);
    assert.equal(antigravityPermissions.denyLines('linux').includes('read_file(~/.config/gh/hosts.yml)'), true);
    assert.deepEqual(antigravityPermissions.prefixAllowRules('teamrig list'), ['command(teamrig list *)']);
    assert.equal(antigravityPermissions.installRoutes({}, 'tag:', ['a']).ok, false);
    assert.equal(antigravityPermissions.uninstallRoutes({}, 'tag:').ok, false);
  });
});
