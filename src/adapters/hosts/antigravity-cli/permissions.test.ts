import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS_CONTRACT, type PermissionsWorld } from '../../../conformance/index.ts';
import { isRecord, isStringArray, type JsonRecord } from '../../../plugin-api/index.ts';
import { declaration } from './declaration.ts';
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

  it('produces proven denyLines with no ~ or *, empty prefixAllowRules, and refuses routes', () => {
    const denySupport = declaration.manifest['permissions.deny-lines'];
    assert.equal(denySupport.kind, 'partial');
    assert.ok(denySupport.notice.includes('~') && denySupport.notice.includes('*'));
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      const lines = antigravityPermissions.denyLines(platform);
      assert.equal(lines.includes('read_file(.env)'), true);
      assert.equal(lines.includes('command(set)'), true);
      assert.deepEqual(
        lines.filter((line) => line.includes('~') || line.includes('*')),
        [],
        `${platform} denyLines must not contain ~ or * while agy 1.5.14 does not match them`,
      );
    }
    assert.deepEqual(antigravityPermissions.prefixAllowRules('teamrig list'), []);
    assert.equal(antigravityPermissions.installRoutes({}, 'tag:', ['a']).ok, false);
    assert.equal(antigravityPermissions.uninstallRoutes({}, 'tag:').ok, false);
  });
});

const permissionsWorld: PermissionsWorld = {
  settings: ({ allow, deny, bypass }) => ({
    theme: 'dark',
    permissions: {
      ...(allow === undefined ? {} : { allow: [...allow] }),
      ...(deny === undefined ? {} : { deny: [...deny] }),
    },
    ...(bypass === true ? { toolPermission: 'always-proceed' } : {}),
  }),
  allowOf: (settings: JsonRecord) => {
    const permissions = settings['permissions'];
    if (!isRecord(permissions)) return undefined;
    const allow = permissions['allow'];
    return isStringArray(allow) ? allow : undefined;
  },
  routes: () => ({ theme: 'dark' }),
  routesOf: () => undefined,
};

describe('antigravityPermissions conformance', () => {
  for (const one of PERMISSIONS_CONTRACT.cases.filter((c) => c.features.includes('permissions.deny-lines'))) {
    it(one.title, () => one.run({ port: antigravityPermissions, world: permissionsWorld }));
  }
});
