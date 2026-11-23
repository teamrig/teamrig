import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hostPlugin } from './plugin.ts';

const CACHE = 'C:\\Users\\me\\.claude\\plugins\\cache';

describe("Claude Code's plugin store", () => {
  it('names its plugin list and marketplace list', () => {
    assert.equal(hostPlugin.listFile, 'installed_plugins.json');
    assert.equal(hostPlugin.marketplacesFile, 'known_marketplaces.json');
  });

  describe('installs', () => {
    it('reads every install under its key, in order, with its reach and a missing version or commit as empty', () => {
      const text = JSON.stringify({
        version: 2,
        plugins: {
          'teamrig@teamrig': [{ scope: 'user', installPath: `${CACHE}\\teamrig\\teamrig\\0.85.0`, version: '0.85.0', gitCommitSha: 'abc' }],
          'p@m': [
            { scope: 'project', installPath: '/cache/m/p/1.0.0', projectPath: '/work/shop' },
            { scope: 'local', installPath: '/cache/m/p/1.0.0', projectPath: '/work/home' },
          ],
          'odd@m': [{ scope: 'managed', installPath: '/cache/m/odd/1', projectPath: '/work/shop' }],
          'bare@m': [{ scope: 'project', installPath: '/cache/m/bare/1' }],
        },
      });
      assert.deepEqual(hostPlugin.installs(text), [
        {
          key: 'teamrig@teamrig',
          plugin: 'teamrig',
          marketplace: 'teamrig',
          reach: { kind: 'every project' },
          installPath: `${CACHE}\\teamrig\\teamrig\\0.85.0`,
          version: '0.85.0',
          revision: 'abc',
        },
        { key: 'p@m', plugin: 'p', marketplace: 'm', reach: { kind: 'project', path: '/work/shop' }, installPath: '/cache/m/p/1.0.0', version: '', revision: '' },
        { key: 'p@m', plugin: 'p', marketplace: 'm', reach: { kind: 'project', path: '/work/home' }, installPath: '/cache/m/p/1.0.0', version: '', revision: '' },
        { key: 'odd@m', plugin: 'odd', marketplace: 'm', reach: { kind: 'unknown' }, installPath: '/cache/m/odd/1', version: '', revision: '' },
        { key: 'bare@m', plugin: 'bare', marketplace: 'm', reach: { kind: 'unknown' }, installPath: '/cache/m/bare/1', version: '', revision: '' },
      ]);
      assert.deepEqual(hostPlugin.installs('{"version": 2, "plugins": {}}'), []);
    });

    it('splits a key at its last @, and reads one with none as a plugin of no marketplace', () => {
      const text = JSON.stringify({ plugins: { '@scope/p@m': [{ scope: 'user', installPath: '/x' }], loose: [{ scope: 'user', installPath: '/y' }] } });
      const read = hostPlugin.installs(text)?.map(({ plugin, marketplace }) => [plugin, marketplace]);
      assert.deepEqual(read, [
        ['@scope/p', 'm'],
        ['loose', ''],
      ]);
    });

    it('reads a half-written file, another shape or one install of another shape as none', () => {
      for (const text of [
        '',
        '{"version": 2, "plu',
        '[]',
        '{"version": 2}',
        '{"plugins": []}',
        '{"plugins": {"p@m": {}}}',
        '{"plugins": {"p@m": [{"scope": "user"}]}}',
        '{"plugins": {"p@m": [{"scope": "user", "installPath": "/x", "version": 2}]}}',
      ]) {
        assert.equal(hostPlugin.installs(text), undefined, text);
      }
    });
  });

  describe('marketplaceSource', () => {
    const known = JSON.stringify({
      kit: { source: { source: 'github', repo: 'owner/kit' }, installLocation: '/claude/plugins/marketplaces/kit' },
      local: { source: { source: 'directory', path: '/work/kit' }, installLocation: '/work/kit' },
      broken: { source: { source: 'github', repo: 'owner/broken' } },
      empty: { source: { source: 'directory', path: '' }, installLocation: '/work/empty' },
    });

    it('reads a cloned marketplace as its clone, and a directory one as its folder', () => {
      assert.deepEqual(hostPlugin.marketplaceSource(known, 'kit'), { kind: 'clone', installLocation: '/claude/plugins/marketplaces/kit' });
      assert.deepEqual(hostPlugin.marketplaceSource(known, 'local'), { kind: 'directory', path: '/work/kit' });
    });

    it('reads an unlisted marketplace, one with no location and a list of another shape as none', () => {
      for (const [text, name] of [
        [known, 'missing'],
        [known, 'broken'],
        [known, 'empty'],
        ['[]', 'kit'],
        ['', 'kit'],
      ] as const) {
        assert.equal(hostPlugin.marketplaceSource(text, name), undefined, name);
      }
    });
  });

  describe('pluginsFolderOf', () => {
    it('finds the plugins folder that holds the cache a plugin runs from', () => {
      assert.equal(hostPlugin.pluginsFolderOf(`${CACHE}\\teamrig\\teamrig\\0.41.0`), 'C:/Users/me/.claude/plugins');
      assert.equal(hostPlugin.pluginsFolderOf('/home/me/.config/claude/plugins/cache/teamrig/teamrig/0.41.0/'), '/home/me/.config/claude/plugins');
    });

    it('finds none for a plugin run from anywhere else', () => {
      for (const root of ['D:\\src\\teamrig\\plugins\\teamrig', '/home/me/plugins/teamrig/0.41.0', 'plugins/cache/m/p/1', '']) {
        assert.equal(hostPlugin.pluginsFolderOf(root), undefined, root);
      }
    });
  });

  describe('isCacheBin', () => {
    it("knows a cached install's bin folder, either slash, a trailing one too, and a moved configuration folder", () => {
      for (const folder of [
        `${CACHE}\\teamrig\\teamrig\\0.75.0\\bin`,
        `${CACHE}\\teamrig\\teamrig\\0.75.0\\bin\\`,
        '/c/Users/me/.claude/plugins/cache/teamrig/teamrig/0.85.1/bin',
        '/srv/claude-config/plugins/cache/tools/lint/1.2.0/bin',
      ]) {
        assert.equal(hostPlugin.isCacheBin(folder), true, folder);
      }
    });

    it('leaves every other folder alone: a checkout, an install folder itself, another folder in it, a short path', () => {
      for (const folder of [
        'D:\\src\\teamrig\\plugins\\teamrig\\bin',
        `${CACHE}\\teamrig\\teamrig\\0.75.0`,
        `${CACHE}\\teamrig\\teamrig\\0.75.0\\dist`,
        '/c/Users/me/.claude/plugins/cache/teamrig/teamrig/bin',
        'plugins/cache/m/p/1/bin',
        '/usr/bin',
        '',
      ]) {
        assert.equal(hostPlugin.isCacheBin(folder), false, folder);
      }
    });
  });

  it('updates the marketplace first, then the plugin under its key', () => {
    assert.deepEqual(hostPlugin.updateSteps('teamrig', 'kit'), [
      ['plugin', 'marketplace', 'update', 'kit'],
      ['plugin', 'update', 'teamrig@kit'],
    ]);
  });

  describe('channelPlan', () => {
    const known = (source: Record<string, string>): string => JSON.stringify({ kit: { source, installLocation: '/clones/kit' } });
    const settingsWith = (source: Record<string, string>) => ({ model: 'opus', extraKnownMarketplaces: { kit: { source, autoUpdate: true }, other: { source: { source: 'github', repo: 'o/o' } } } });

    it('adds a git url marketplace again at the ref, then reinstalls the plugin from it', () => {
      const answer = hostPlugin.channelPlan({}, known({ source: 'git', url: 'https://example.test/kit.git' }), 'teamrig', 'kit', 'preview');
      assert.deepEqual(answer, {
        ok: true,
        value: { settings: undefined, before: undefined, after: 'preview', steps: [['plugin', 'marketplace', 'add', 'https://example.test/kit.git#preview'], ['plugin', 'update', 'teamrig@kit']] },
      });
    });

    it("sets the ref on the settings' own entry, keeping every other field and marketplace", () => {
      const answer = hostPlugin.channelPlan(settingsWith({ source: 'github', repo: 'acme/kit' }), known({ source: 'github', repo: 'acme/kit' }), 'teamrig', 'kit', 'preview');
      assert.ok(answer.ok);
      assert.deepEqual(answer.value.settings, settingsWith({ source: 'github', repo: 'acme/kit', ref: 'preview' }));
    });

    it('drops the ref for the default branch, from the settings and the source added', () => {
      const answer = hostPlugin.channelPlan(settingsWith({ source: 'github', repo: 'acme/kit', ref: 'preview' }), known({ source: 'github', repo: 'acme/kit', ref: 'preview' }), 'teamrig', 'kit', undefined);
      assert.ok(answer.ok);
      assert.deepEqual(answer.value.settings, settingsWith({ source: 'github', repo: 'acme/kit' }));
      assert.deepEqual(answer.value.steps[0], ['plugin', 'marketplace', 'add', 'acme/kit']);
    });

    it('fixes a settings entry left on another ref with no step when the clone already follows the ref', () => {
      const answer = hostPlugin.channelPlan(settingsWith({ source: 'github', repo: 'acme/kit' }), known({ source: 'github', repo: 'acme/kit', ref: 'preview' }), 'teamrig', 'kit', 'preview');
      assert.ok(answer.ok);
      assert.deepEqual(answer.value.steps, []);
      assert.deepEqual(answer.value.settings, settingsWith({ source: 'github', repo: 'acme/kit', ref: 'preview' }));
    });

    it('refuses a marketplace read from a url or a folder, and a list that is not JSON', () => {
      for (const text of [known({ source: 'url', url: 'https://example.test/marketplace.json' }), known({ source: 'directory', path: '/work/kit' }), 'not json']) {
        const answer = hostPlugin.channelPlan({}, text, 'teamrig', 'kit', 'preview');
        assert.equal(answer.ok, false, text);
        assert.equal(hostPlugin.marketplaceRef(text, 'kit'), undefined, text);
      }
    });
  });
});
