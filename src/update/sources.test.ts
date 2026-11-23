import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PluginInstall } from '../ports/host/index.ts';
import { shippedPlugin } from '../testing/shipped-plugin.ts';
import { channelOf, pluginFilePath, pluginSourceOf, pluginVersionOf, sameRepository, trackedInstallsOf } from './sources.ts';

const PLUGIN = shippedPlugin();

/** The installs the shipped host reads from a plugin list holding `plugins`; none for a list of another shape. */
function pluginList(plugins: Readonly<Record<string, readonly Readonly<Record<string, string>>[]>> | string): readonly PluginInstall[] {
  return PLUGIN.installs(typeof plugins === 'string' ? plugins : JSON.stringify({ version: 2, plugins })) ?? [];
}

const user = (version: string): Readonly<Record<string, string>> => ({ scope: 'user', installPath: `/cache/${version}`, version });
const project = (version: string): Readonly<Record<string, string>> => ({ scope: 'project', installPath: `/cache/${version}`, version, projectPath: '/app' });

describe('trackedInstallsOf', () => {
  it('reads teamrig and teamrig-pane installs with their marketplaces, leaving other plugins out', () => {
    const text = pluginList({ 'teamrig@kit': [user('0.3.0')], 'teamrig-pane@pane': [user('0.7.1')], 'other@kit': [user('1.0.0')] });
    assert.deepEqual(trackedInstallsOf(text), [
      { plugin: 'teamrig', marketplace: 'kit', version: '0.3.0' },
      { plugin: 'teamrig-pane', marketplace: 'pane', version: '0.7.1' },
    ]);
  });

  it('takes the user-scope install over a project one listed first', () => {
    const text = pluginList({ 'teamrig@kit': [project('0.2.0'), user('0.3.0')] });
    assert.deepEqual(trackedInstallsOf(text), [{ plugin: 'teamrig', marketplace: 'kit', version: '0.3.0' }]);
  });

  it('takes the first install when none is user-scope', () => {
    const text = pluginList({ 'teamrig@kit': [project('0.2.0'), project('0.4.0')] });
    assert.deepEqual(trackedInstallsOf(text), [{ plugin: 'teamrig', marketplace: 'kit', version: '0.2.0' }]);
  });

  it('leaves out an install with no release version or no marketplace, and reads a list of another shape as none', () => {
    assert.deepEqual(trackedInstallsOf(pluginList({ 'teamrig@kit': [user('main')], teamrig: [user('0.3.0')] })), []);
    assert.deepEqual(trackedInstallsOf(pluginList('{"plugins": []}')), []);
    assert.deepEqual(trackedInstallsOf(pluginList('not json')), []);
  });
});

describe('pluginSourceOf', () => {
  const marketplace = (source: unknown): string => JSON.stringify({ name: 'kit', plugins: [{ name: 'other', source: './x' }, { name: 'teamrig', source }] });
  const local = (folder: string) => ({ folder, ref: undefined, url: undefined });

  it('reads the plugin folder a relative source names, without its ./ and trailing slash', () => {
    assert.deepEqual(pluginSourceOf(marketplace('./plugins/teamrig'), 'teamrig'), local('plugins/teamrig'));
    assert.deepEqual(pluginSourceOf(marketplace('./plugins/teamrig/'), 'teamrig'), local('plugins/teamrig'));
    assert.deepEqual(pluginSourceOf(marketplace('./'), 'teamrig'), local(''));
  });

  it("reads a git-subdir source's path, repository and branch (T4355, T5133)", () => {
    const subdir = (path: unknown, ref: unknown = 'release'): string => marketplace({ source: 'git-subdir', url: 'owner/teamrig', path, ref });
    const fromRelease = { folder: 'plugins/teamrig', ref: 'release', url: 'owner/teamrig' };
    assert.deepEqual(pluginSourceOf(subdir('plugins/teamrig'), 'teamrig'), fromRelease);
    assert.deepEqual(pluginSourceOf(subdir('./plugins/teamrig/'), 'teamrig'), fromRelease);
    assert.deepEqual(pluginSourceOf(subdir('plugins/teamrig', 'preview'), 'teamrig'), { ...fromRelease, ref: 'preview' });
    for (const path of ['', '/abs/teamrig', 'plugins/../../elsewhere', 'plugins\\teamrig', 3]) {
      assert.equal(pluginSourceOf(subdir(path), 'teamrig'), undefined, JSON.stringify(path));
    }
  });

  it('reads no branch for a ref git could take as an option, a pattern or a range', () => {
    for (const ref of ['--upload-pack=x', 'a..b', 'refs/*', 'a b', 'main:x', 'x/', 3]) {
      const text = marketplace({ source: 'git-subdir', url: 'owner/teamrig', path: 'plugins/teamrig', ref });
      assert.equal(pluginSourceOf(text, 'teamrig')?.ref, undefined, JSON.stringify(ref));
    }
  });

  it('reads no source for another kind of source, a path that climbs out, or an unlisted plugin', () => {
    assert.equal(pluginSourceOf(marketplace({ source: 'github', repo: 'owner/teamrig' }), 'teamrig'), undefined);
    assert.equal(pluginSourceOf(marketplace('./../elsewhere'), 'teamrig'), undefined);
    assert.equal(pluginSourceOf(marketplace('/abs/teamrig'), 'teamrig'), undefined);
    assert.equal(pluginSourceOf(marketplace('./plugins/teamrig'), 'teamrig-pane'), undefined);
    assert.equal(pluginSourceOf('{}', 'teamrig'), undefined);
  });
});

describe('sameRepository', () => {
  it('reads https, ssh and owner/name addresses of one repository as the same, in any case', () => {
    for (const address of ['https://github.com/owner/kit.git', 'https://github.com/Owner/Kit', 'git@github.com:owner/kit.git', 'ssh://git@github.com/owner/kit', 'owner/kit/']) {
      assert.equal(sameRepository(address, 'owner/kit'), true, address);
    }
  });

  it('reads another repository, or an empty address, as not the same', () => {
    assert.equal(sameRepository('https://github.com/owner/kit-pane.git', 'owner/kit'), false);
    assert.equal(sameRepository('https://github.com/other/kit.git', 'https://github.com/owner/kit.git'), false);
    assert.equal(sameRepository('', ''), false);
  });
});

describe('pluginFilePath and pluginVersionOf', () => {
  it('names the plugin.json in a folder or at the root', () => {
    assert.equal(pluginFilePath('plugins/teamrig'), 'plugins/teamrig/.claude-plugin/plugin.json');
    assert.equal(pluginFilePath(''), '.claude-plugin/plugin.json');
  });

  it('reads a release version, and nothing else', () => {
    assert.equal(pluginVersionOf('{"name": "teamrig", "version": "0.333.0"}'), '0.333.0');
    assert.equal(pluginVersionOf('{"version": "0.333.0-beta"}'), undefined);
    assert.equal(pluginVersionOf('{"version": 3}'), undefined);
    assert.equal(pluginVersionOf('nope'), undefined);
  });
});

describe('channelOf', () => {
  it('reads release as the stable channel and preview as the preview one, any other branch as none (T5133)', () => {
    assert.equal(channelOf('release'), 'stable');
    assert.equal(channelOf('preview'), 'preview');
    assert.equal(channelOf('main'), undefined);
    assert.equal(channelOf(undefined), undefined);
  });
});
