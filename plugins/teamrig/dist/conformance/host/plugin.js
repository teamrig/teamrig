import assert from 'node:assert/strict';
import { defineContract } from "../contract.js";
/** Installs of every reach, one with no version or revision, no liar's fixed answer equals. */
const INSTALLS = [
    { plugin: 'teamrig', marketplace: 'kit', reach: { kind: 'every project' }, installPath: '/cache/kit/teamrig/1.2.0', version: '1.2.0', revision: 'a1b2c3d' },
    { plugin: 'teamrig', marketplace: 'kit', reach: { kind: 'project', path: '/work/app' }, installPath: '/cache/kit/teamrig/1.1.0', version: '1.1.0', revision: 'e4f5a6b' },
    { plugin: 'helper', marketplace: 'tools', reach: { kind: 'unknown' }, installPath: '/cache/tools/helper/unknown', version: '', revision: '' },
];
const DIRECTORY = { name: 'kit', source: { kind: 'directory', path: '/work/kit' } };
const CLONE = { name: 'tools', source: { kind: 'clone', installLocation: '/home/me/marketplaces/tools' } };
/** A plugin run from a folder of its own, outside the host's cache. */
const OUTSIDE = '/work/teamrig';
/** A path with either separator and no trailing one, so a host on Windows compares equal. */
function samePath(path) {
    return path?.replaceAll('\\', '/').replace(/\/+$/, '');
}
function sourceOf(source) {
    if (source === undefined) {
        return undefined;
    }
    return source.kind === 'directory' ? { kind: 'directory', path: samePath(source.path) ?? '' } : { kind: 'clone', installLocation: samePath(source.installLocation) ?? '' };
}
function reachOf(reach) {
    return reach.kind === 'project' ? { kind: 'project', path: samePath(reach.path) ?? '' } : reach;
}
/** An install as a case compares it: without its key, the paths in one form. */
function shownOf(install) {
    const { plugin, marketplace, reach, installPath, version, revision } = install;
    return { plugin, marketplace, reach: reachOf(reach), installPath: samePath(installPath) ?? '', version, revision };
}
function installsOf(port, text) {
    const read = port.installs(text);
    assert.ok(read !== undefined, 'the plugin list was read as one of another shape');
    return read;
}
const CASES = [
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
            for (const [plugin, marketplace] of [['teamrig', 'kit'], ['helper', 'tools']]) {
                const steps = port.updateSteps(plugin, marketplace);
                assert.ok(steps.length > 0, `no step updates ${plugin}`);
                assert.ok(steps.every((step) => step.length > 0 && step.every((word) => word.trim() !== '')), `a step of ${plugin} has an empty word`);
                const words = steps.flat().join(' ');
                assert.ok(words.includes(plugin) && words.includes(marketplace), `the steps ${JSON.stringify(steps)} do not name ${plugin} and ${marketplace}`);
            }
        },
    },
];
/** The liars' world: each list its own JSON, the cache under `/plugins/cache`. */
const WORLD = {
    list: (installs) => JSON.stringify(installs),
    marketplaces: (entries) => JSON.stringify(entries),
    cacheRoot: (marketplace, plugin, version) => `/plugins/cache/${marketplace}/${plugin}/${version}`,
    pluginsFolder: '/plugins',
};
const FILES = { listFile: 'plugins.json', marketplacesFile: 'marketplaces.json' };
/** A liar that claims the port and does nothing: no install, no marketplace, no cache and no step. */
export function nothingPlugin() {
    return {
        world: WORLD,
        port: { ...FILES, installs: () => undefined, marketplaceSource: () => undefined, pluginsFolderOf: () => undefined, isCacheBin: () => false, updateSteps: () => [] },
    };
}
/** A liar that says yes to all: every list holds one fixed install and marketplace, every folder is in the cache, one fixed step updates all. */
export function yesPlugin() {
    const install = { key: 'key', plugin: 'plugin', marketplace: 'market', reach: { kind: 'every project' }, installPath: '/', version: '1', revision: '' };
    return {
        world: WORLD,
        port: {
            ...FILES,
            installs: () => [install],
            marketplaceSource: () => ({ kind: 'directory', path: '/' }),
            pluginsFolderOf: () => '/',
            isCacheBin: () => true,
            updateSteps: () => [['update']],
        },
    };
}
/** What every host's plugin port must do with the plugin list, the marketplace list and the cache it keeps. */
export const PLUGIN_CONTRACT = defineContract({
    port: 'plugin',
    side: 'host',
    cases: CASES,
    liars: [nothingPlugin, yesPlugin],
});
