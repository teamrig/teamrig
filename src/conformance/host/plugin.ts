import assert from 'node:assert/strict';
import type { ChannelPlan, HostPlugin, InstallReach, JsonRecord, MarketplaceSource, PluginInstall } from '../../plugin-api/index.ts';
import { defineContract, type ContractCase, type Subject } from '../contract.ts';

/** An install a case has the host's plugin list hold: everything the port reads back but the host's own key. */
export type WorldInstall = Omit<PluginInstall, 'key'>;

/** A marketplace a case has the host's marketplace list hold. */
export interface WorldMarketplace {
  readonly name: string;
  readonly source: MarketplaceSource;
  /** The branch or tag a clone follows; none for its default branch, and always none for a directory. */
  readonly ref?: string;
}

/**
 * What the plugin port sees of the host: the texts of its plugin list and marketplace list, and the folders of its
 * cache. The world writes them in the host's own shapes, so a case never learns those shapes.
 */
export interface PluginWorld {
  /** The plugin list holding these installs, in this order, and nothing else. */
  readonly list: (installs: readonly WorldInstall[]) => string;
  /** The marketplace list holding these marketplaces and nothing else. */
  readonly marketplaces: (entries: readonly WorldMarketplace[]) => string;
  /** User settings naming each of these marketplaces' sources themselves, as a person who added them there has. */
  readonly settings: (entries: readonly WorldMarketplace[]) => JsonRecord;
  /** The root of `plugin` at `version`, from `marketplace`, as the host's cache holds it. */
  readonly cacheRoot: (marketplace: string, plugin: string, version: string) => string;
  /** The plugins folder that cache sits in. */
  readonly pluginsFolder: string;
}

export type PluginSubject = Subject<HostPlugin, PluginWorld>;
export type PluginCase = ContractCase<HostPlugin, PluginWorld, 'host'>;

/** Installs of every reach, one with no version or revision, no liar's fixed answer equals. */
const INSTALLS: readonly WorldInstall[] = [
  { plugin: 'teamrig', marketplace: 'kit', reach: { kind: 'every project' }, installPath: '/cache/kit/teamrig/1.2.0', version: '1.2.0', revision: 'a1b2c3d' },
  { plugin: 'teamrig', marketplace: 'kit', reach: { kind: 'project', path: '/work/app' }, installPath: '/cache/kit/teamrig/1.1.0', version: '1.1.0', revision: 'e4f5a6b' },
  { plugin: 'helper', marketplace: 'tools', reach: { kind: 'unknown' }, installPath: '/cache/tools/helper/unknown', version: '', revision: '' },
];

const DIRECTORY: WorldMarketplace = { name: 'kit', source: { kind: 'directory', path: '/work/kit' } };
const CLONE: WorldMarketplace = { name: 'tools', source: { kind: 'clone', installLocation: '/home/me/marketplaces/tools' } };

/** A plugin run from a folder of its own, outside the host's cache. */
const OUTSIDE = '/work/teamrig';

/** A path with either separator and no trailing one, so a host on Windows compares equal. */
function samePath(path: string | undefined): string | undefined {
  return path?.replaceAll('\\', '/').replace(/\/+$/, '');
}

function sourceOf(source: MarketplaceSource | undefined): MarketplaceSource | undefined {
  if (source === undefined) {
    return undefined;
  }
  return source.kind === 'directory' ? { kind: 'directory', path: samePath(source.path) ?? '' } : { kind: 'clone', installLocation: samePath(source.installLocation) ?? '' };
}

function reachOf(reach: InstallReach): InstallReach {
  return reach.kind === 'project' ? { kind: 'project', path: samePath(reach.path) ?? '' } : reach;
}

/** An install as a case compares it: without its key, the paths in one form. */
function shownOf(install: PluginInstall | WorldInstall): WorldInstall {
  const { plugin, marketplace, reach, installPath, version, revision } = install;
  return { plugin, marketplace, reach: reachOf(reach), installPath: samePath(installPath) ?? '', version, revision };
}

function planOf(port: HostPlugin, ...args: Parameters<HostPlugin['channelPlan']>): ChannelPlan {
  const answer = port.channelPlan(...args);
  assert.ok(answer.ok, answer.ok ? '' : answer.problem);
  return answer.value;
}

/** Whether any word of the plan's steps or its settings names `ref`. */
function names(plan: ChannelPlan, ref: string): boolean {
  return plan.steps.flat().some((word) => word.includes(ref)) || JSON.stringify(plan.settings ?? {}).includes(ref);
}

function installsOf(port: HostPlugin, text: string): readonly PluginInstall[] {
  const read = port.installs(text);
  assert.ok(read !== undefined, 'the plugin list was read as one of another shape');
  return read;
}

const CASES: readonly PluginCase[] = [
  {
    id: 'plugin.reads-installs',
    title: 'reads every install the plugin list holds, in its order, each under a key of its own',
    features: ['plugin.install-update'],
    run: ({ port, world }) => {
      assert.notEqual(port.listFile.trim(), '', 'the plugin list has no file name');
      const read = installsOf(port, world.list(INSTALLS));
      assert.deepEqual(read.map(shownOf), INSTALLS.map(shownOf));
      const keys = new Set(read.map((install) => install.key));
      assert.ok(read.every((install) => install.key.trim() !== ''), 'an install has no key');
      assert.equal(keys.size, 2, 'two installs of one plugin share their key, and only they do');
      assert.deepEqual(installsOf(port, world.list([])), []);
    },
  },
  {
    id: 'plugin.list-of-another-shape',
    title: 'reads a plugin list cut off mid-write as none, never as an empty list',
    features: ['plugin.install-update'],
    run: ({ port, world }) => {
      const text = world.list(INSTALLS);
      assert.equal(port.installs(text.slice(0, Math.floor(text.length / 2))), undefined);
      assert.equal(port.installs(''), undefined);
    },
  },
  {
    id: 'plugin.reads-marketplaces',
    title: 'finds where each marketplace lives, a local folder or a clone, and nothing for one not listed',
    features: ['plugin.install-update'],
    run: ({ port, world }) => {
      assert.notEqual(port.marketplacesFile.trim(), '', 'the marketplace list has no file name');
      assert.notEqual(port.marketplacesFile, port.listFile, 'the two lists share one file');
      const text = world.marketplaces([DIRECTORY, CLONE]);
      for (const entry of [DIRECTORY, CLONE]) {
        assert.deepEqual(sourceOf(port.marketplaceSource(text, entry.name)), sourceOf(entry.source), entry.name);
      }
      assert.equal(port.marketplaceSource(text, 'missing'), undefined);
      assert.equal(port.marketplaceSource(world.marketplaces([]), DIRECTORY.name), undefined);
    },
  },
  {
    id: 'plugin.finds-cache',
    title: "finds the plugins folder of a plugin run from the host's cache, and its bin folder, with either separator",
    features: ['plugin.cli-on-path'],
    run: ({ port, world }) => {
      const root = world.cacheRoot('kit', 'teamrig', '1.2.0');
      for (const path of [root, root.replaceAll('/', '\\')]) {
        assert.equal(samePath(port.pluginsFolderOf(path)), samePath(world.pluginsFolder), path);
        assert.ok(port.isCacheBin(`${path}/bin`), `${path}/bin is not read as the cache's bin folder`);
      }
      assert.equal(port.pluginsFolderOf(OUTSIDE), undefined);
      assert.equal(port.isCacheBin(`${OUTSIDE}/bin`), false, 'a bin folder outside the cache is read as one in it');
      assert.equal(port.isCacheBin(root), false, "the install's own root is read as its bin folder");
    },
  },
  {
    id: 'plugin.update-steps',
    title: 'names the steps that update a plugin from its marketplace, each naming what it updates',
    features: ['plugin.install-update'],
    run: ({ port }) => {
      for (const [plugin, marketplace] of [['teamrig', 'kit'], ['helper', 'tools']] as const) {
        const steps = port.updateSteps(plugin, marketplace);
        assert.ok(steps.length > 0, `no step updates ${plugin}`);
        assert.ok(steps.every((step) => step.length > 0 && step.every((word) => word.trim() !== '')), `a step of ${plugin} has an empty word`);
        const words = steps.flat().join(' ');
        assert.ok(words.includes(plugin) && words.includes(marketplace), `the steps ${JSON.stringify(steps)} do not name ${plugin} and ${marketplace}`);
      }
    },
  },
  {
    id: 'plugin.channel-ref',
    title: 'reads the branch a cloned marketplace follows, its default branch apart from one not listed',
    features: ['plugin.install-update'],
    run: ({ port, world }) => {
      const text = world.marketplaces([{ ...CLONE, ref: 'preview' }, DIRECTORY]);
      assert.deepEqual(port.marketplaceRef(text, CLONE.name), { ref: 'preview' });
      assert.deepEqual(port.marketplaceRef(world.marketplaces([CLONE]), CLONE.name), { ref: undefined });
      assert.equal(port.marketplaceRef(text, DIRECTORY.name), undefined, 'a local folder is read as a clone');
      assert.equal(port.marketplaceRef(text, 'missing'), undefined);
    },
  },
  {
    id: 'plugin.channel-plan',
    title: 'moves a cloned marketplace to a branch and back, its settings entry with it, and refuses one not cloned',
    features: ['plugin.install-update'],
    run: ({ port, world }) => {
      const onDefault = world.marketplaces([CLONE]);
      const onPreview = world.marketplaces([{ ...CLONE, ref: 'preview' }]);
      const toPreview = planOf(port, world.settings([CLONE]), onDefault, 'helper', CLONE.name, 'preview');
      assert.deepEqual([toPreview.before, toPreview.after], [undefined, 'preview']);
      assert.ok(toPreview.settings !== undefined, 'the settings entry naming the marketplace was left on its default branch');
      assert.ok(toPreview.steps.length > 0 && names(toPreview, 'preview'), `the plan ${JSON.stringify(toPreview)} never names the branch`);
      const words = toPreview.steps.flat().join(' ');
      assert.ok(words.includes('helper') && words.includes(CLONE.name), `the steps ${words} do not name the plugin and its marketplace`);
      const back = planOf(port, world.settings([{ ...CLONE, ref: 'preview' }]), onPreview, 'helper', CLONE.name, undefined);
      assert.deepEqual([back.before, back.after], ['preview', undefined]);
      assert.ok(back.settings !== undefined && back.steps.length > 0 && !names(back, 'preview'), `the way back ${JSON.stringify(back)} still names the branch`);
      const stay = planOf(port, world.settings([{ ...CLONE, ref: 'preview' }]), onPreview, 'helper', CLONE.name, 'preview');
      assert.deepEqual(stay, { settings: undefined, before: 'preview', after: 'preview', steps: [] });
      assert.equal(planOf(port, {}, onDefault, 'helper', CLONE.name, 'preview').settings, undefined, 'settings naming no marketplace were changed');
      const listed = world.marketplaces([DIRECTORY, CLONE]);
      for (const name of [DIRECTORY.name, 'missing']) {
        assert.equal(port.channelPlan({}, listed, 'helper', name, 'preview').ok, false, `${name} was moved to a branch`);
      }
    },
  },
];

/** The liars' world: each list its own JSON, the cache under `/plugins/cache`. */
const WORLD: PluginWorld = {
  list: (installs) => JSON.stringify(installs),
  marketplaces: (entries) => JSON.stringify(entries),
  settings: (entries) => ({ marketplaces: entries.map((entry) => entry.name) }),
  cacheRoot: (marketplace, plugin, version) => `/plugins/cache/${marketplace}/${plugin}/${version}`,
  pluginsFolder: '/plugins',
};

const FILES = { listFile: 'plugins.json', marketplacesFile: 'marketplaces.json' } as const;

/** A liar that claims the port and does nothing: no install, no marketplace, no cache, no step and no branch. */
export function nothingPlugin(): PluginSubject {
  return {
    world: WORLD,
    port: { ...FILES, installs: () => undefined, marketplaceSource: () => undefined, pluginsFolderOf: () => undefined, isCacheBin: () => false, updateSteps: () => [], marketplaceRef: () => undefined, channelPlan: () => ({ ok: false, problem: 'none' }) },
  };
}

/**
 * A liar that says yes to all: every list holds one fixed install and marketplace on its default branch, every folder
 * is in the cache, one fixed step updates all and moves any marketplace to any branch.
 */
export function yesPlugin(): PluginSubject {
  const install: PluginInstall = { key: 'key', plugin: 'plugin', marketplace: 'market', reach: { kind: 'every project' }, installPath: '/', version: '1', revision: '' };
  return {
    world: WORLD,
    port: {
      ...FILES,
      installs: () => [install],
      marketplaceSource: () => ({ kind: 'directory', path: '/' }),
      pluginsFolderOf: () => '/',
      isCacheBin: () => true,
      updateSteps: () => [['update']],
      marketplaceRef: () => ({ ref: undefined }),
      channelPlan: () => ({ ok: true, value: { settings: {}, before: undefined, after: undefined, steps: [['update']] } }),
    },
  };
}

/** What every host's plugin port must do with the plugin list, the marketplace list and the cache it keeps. */
export const PLUGIN_CONTRACT = defineContract<HostPlugin, PluginWorld, 'host'>({
  port: 'plugin',
  side: 'host',
  cases: CASES,
  liars: [nothingPlugin, yesPlugin],
});
