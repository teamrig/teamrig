/**
 * Where a newer teamrig or teamrig-pane is published (T2466): the host's plugin list, read through its plugin port,
 * names each install's version and marketplace, the port's marketplace list where that marketplace lives, and the
 * marketplace's `marketplace.json` the folder of each plugin in it, whose `.claude-plugin/plugin.json` holds the version
 * published. Plain parsers: a file of another shape reads as nothing, so the update notice stays quiet rather than wrong.
 */
import { isRecord } from '../core/guards.ts';
import { parseVersion } from '../core/release-version.ts';
import type { PluginInstall } from '../ports/host/index.ts';

/** The plugins the update notice tells of: teamrig's own, each from its own marketplace. */
export const TRACKED_PLUGINS: readonly string[] = ['teamrig', 'teamrig-pane'];

/** The file in a marketplace that lists its plugins. */
export const MARKETPLACE_FILE = '.claude-plugin/marketplace.json';
/** The file in a plugin's folder that holds its version. */
export const PLUGIN_FILE = '.claude-plugin/plugin.json';

/** An install of a tracked plugin, as the plugin list records it. */
export interface TrackedInstall {
  readonly plugin: string;
  readonly marketplace: string;
  readonly version: string;
}

function parsed(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

/**
 * The tracked plugins' installs among `installs` (the host's plugin list), one per plugin and marketplace: the one
 * that serves every project where there is one (what a tab outside a project's install runs), else the first listed.
 * An install with no marketplace or no release version is left out.
 */
export function trackedInstallsOf(installs: readonly PluginInstall[]): readonly TrackedInstall[] {
  const chosen = new Map<string, TrackedInstall & { readonly everywhere: boolean }>();
  for (const { key, plugin, marketplace, reach, version } of installs) {
    if (marketplace === '' || !TRACKED_PLUGINS.includes(plugin) || parseVersion(version) === undefined) {
      continue;
    }
    const everywhere = reach.kind === 'every project';
    const held = chosen.get(key);
    if (held === undefined || (everywhere && !held.everywhere)) {
      chosen.set(key, { plugin, marketplace, version, everywhere });
    }
  }
  return [...chosen.values()].map(({ plugin, marketplace, version }) => ({ plugin, marketplace, version }));
}

/**
 * Where a marketplace installs a plugin from: its folder, relative to the repository's root with no `./` or trailing
 * slash (`plugins/teamrig`; `` for the root itself), and for a `git-subdir` source the repository and branch it names.
 */
export interface PluginSource {
  readonly folder: string;
  /** The branch a `git-subdir` source installs (`release`, `preview`); undefined for the marketplace's own commit. */
  readonly ref: string | undefined;
  /** The repository a `git-subdir` source names, as written; undefined for the marketplace's own repository. */
  readonly url: string | undefined;
}

/**
 * Where `plugin` is installed from in a marketplace; undefined when the marketplace does not list it, or names another
 * kind of source.
 *
 * A `git-subdir` source (`{"source": "git-subdir", "url": ..., "path": "plugins/teamrig", "ref": "release"}`) installs
 * the folder `path` of the branch `ref`. With release channels (T5133) main runs ahead of every channel's branch, so
 * src/update/check.ts reads the version published on that branch, never in the marketplace's own commit.
 */
export function pluginSourceOf(marketplaceText: string, plugin: string): PluginSource | undefined {
  const marketplace = parsed(marketplaceText);
  const plugins = isRecord(marketplace) ? marketplace['plugins'] : undefined;
  if (!Array.isArray(plugins)) {
    return undefined;
  }
  for (const entry of plugins) {
    if (isRecord(entry) && entry['name'] === plugin) {
      return sourceOf(entry['source']);
    }
  }
  return undefined;
}

function sourceOf(source: unknown): PluginSource | undefined {
  if (typeof source === 'string') {
    const folder = source.startsWith('./') ? folderIn(source.slice(2)) : undefined;
    return folder === undefined ? undefined : { folder, ref: undefined, url: undefined };
  }
  if (!isRecord(source) || source['source'] !== 'git-subdir') {
    return undefined;
  }
  const { path, ref, url } = source;
  const folder = typeof path === 'string' && path !== '' ? folderIn(path.replace(/^\.\//, '')) : undefined;
  if (folder === undefined) {
    return undefined;
  }
  return {
    folder,
    ref: typeof ref === 'string' && isBranchName(ref) ? ref : undefined,
    url: typeof url === 'string' && url.trim() !== '' ? url : undefined,
  };
}

/** A name git may be asked for as `refs/heads/<name>`: letters, digits, `.`, `_`, `/` and `-`, no leading `-` or `..`. */
export function isBranchName(name: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(name) && !name.startsWith('-') && !name.includes('..') && !name.endsWith('/');
}

/** The release channel a branch carries (T5133): `release` is the stable channel, `preview` the preview one; any other none. */
export function channelOf(branch: string | undefined): string | undefined {
  if (branch === 'release') {
    return 'stable';
  }
  return branch === 'preview' ? 'preview' : undefined;
}

/**
 * Whether two repository addresses name the same repository: `https://github.com/owner/kit.git`, `owner/kit` and
 * `git@github.com:owner/kit` all read as `owner/kit`, in any letter case. A `git-subdir` branch is fetched through
 * the marketplace's own bare repository, so only a branch of that repository is read.
 */
export function sameRepository(a: string, b: string): boolean {
  const key = (address: string): string =>
    address
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?[^/]+\//, '')
      .replace(/^[^@/:]+@[^:/]+:/, '')
      .replace(/\/+$/, '')
      .replace(/\.git$/, '');
  return key(a) !== '' && key(a) === key(b);
}

/** A relative folder without its trailing slash; undefined for one that starts at the root, climbs out or uses `\`. */
function folderIn(path: string): string | undefined {
  return path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') ? undefined : path.replace(/\/+$/, '');
}

/** The path of a plugin's plugin.json in its marketplace, given its folder there. */
export function pluginFilePath(folder: string): string {
  return folder === '' ? PLUGIN_FILE : `${folder}/${PLUGIN_FILE}`;
}

/** The release version a plugin.json names; undefined when it names none of MAJOR.MINOR.PATCH form. */
export function pluginVersionOf(pluginText: string): string | undefined {
  const plugin = parsed(pluginText);
  const version = isRecord(plugin) ? plugin['version'] : undefined;
  return typeof version === 'string' && parseVersion(version) !== undefined ? version : undefined;
}
