import { join } from 'node:path';
import type { Files } from '../core/files.ts';
import { errorMessage, isRecord, stringField } from '../core/guards.ts';
import { parseObject, recordVersion, VERSION_FIELD } from '../core/jsonl.ts';
import { LockBusyError, type Mutex } from '../core/lock.ts';
import { compareVersions, parseVersion, type Version } from '../core/release-version.ts';
import { checkClient, CLIENT_MANIFEST, clientFileHash } from '../exec/client-integrity.ts';
import type { KitTree } from './kit-tree.ts';

/**
 * teamrig's own install under the kit home (T5278, design D): one full copy of each release in `versions/<v>/`, and
 * the version in use named twice, by the one-line `current` the launcher reads first and by `current.json`, which adds
 * the sha256 of that version's integrity list, where it came from and whether `teamrig use` pinned it. Every host's
 * hook line runs the kit home's fixed launcher, which runs the version `current` names, so an upgrade only adds a folder
 * and moves `current`, and the hook text a host trusts never changes.
 *
 * A copy goes to `versions/<v>.partial/` first and is renamed to `<v>/` only once every file matches its integrity
 * list, so a half-copied version is never one `current` names. Both records are written by temp file and rename. A pin
 * keeps `current` where `teamrig use` put it: an install of a newer version adds its folder and moves nothing, or the
 * next session start of a newer plugin would undo a rollback.
 */

/** `current.json`'s format; a field added to it raises this. */
export const KIT_CURRENT_FORMAT = 1;

/** How many versions older than `current` an install keeps, so `teamrig use` can roll back to them. */
export const KEPT_OLDER_VERSIONS = 2;

/** The folder of every installed version: `<kit home>/versions`. */
export function kitVersionsFolder(kitHome: string): string {
  return join(kitHome, 'versions');
}

/** One installed version's folder: `<kit home>/versions/<v>`. */
export function kitVersionFolder(kitHome: string, version: string): string {
  return join(kitVersionsFolder(kitHome), version);
}

/** The one-line name of the version in use: `<kit home>/current`. */
export function kitCurrentPath(kitHome: string): string {
  return join(kitHome, 'current');
}

/** The record of the version in use: `<kit home>/current.json`. */
export function kitCurrentRecordPath(kitHome: string): string {
  return join(kitHome, 'current.json');
}

/** Where a kept version came from, beside its folder: `<kit home>/versions/<v>.source.json`. */
function sourcePath(kitHome: string, version: string): string {
  return `${kitVersionFolder(kitHome, version)}.source.json`;
}

/** Where an installed version came from: the Claude Code plugin copying itself, or a release checked out by its tag. */
export type KitSource = { readonly kind: 'claude-code-plugin' } | { readonly kind: 'github-release'; readonly tag: string; readonly commit: string };

/** The version in use, as both records name it. */
export interface KitCurrent {
  readonly version: string;
  /** The sha256 of the version's `dist/integrity.json`, CRLF read as LF, which the launcher checks the list against. */
  readonly listHash: string;
  readonly source: KitSource;
  /** Set by `teamrig use <v>`: an install leaves `current` alone until `teamrig use --latest`. */
  readonly pinned: boolean;
}

function sourceOf(value: unknown): KitSource | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const kind = stringField(value, 'kind');
  if (kind === 'claude-code-plugin') {
    return { kind };
  }
  const tag = stringField(value, 'tag');
  const commit = stringField(value, 'commit');
  return kind === 'github-release' && tag !== undefined && commit !== undefined ? { kind, tag, commit } : undefined;
}

/**
 * The version in use, or undefined when there is none or the two records disagree: `current` must be one release
 * version (no path, no `..`), and `current.json` must name that same version with a well-formed list hash.
 */
export async function readKitCurrent(files: Pick<Files, 'read'>, kitHome: string): Promise<KitCurrent | undefined> {
  const line = (await files.read(kitCurrentPath(kitHome)))?.trim();
  const text = await files.read(kitCurrentRecordPath(kitHome));
  const record = text === undefined ? undefined : parseObject(text.trim());
  if (line === undefined || parseVersion(line) === undefined || record === undefined || recordVersion(record) !== KIT_CURRENT_FORMAT) {
    return undefined;
  }
  const listHash = stringField(record, 'listHash');
  const source = sourceOf(record['source']);
  const pinned = record['pinned'];
  if (stringField(record, 'version') !== line || listHash === undefined || !/^[0-9a-f]{64}$/.test(listHash) || source === undefined || typeof pinned !== 'boolean') {
    return undefined;
  }
  return { version: line, listHash, source, pinned };
}

/** Writes `current.json`, then `current`, each by temp file and rename. */
async function writeKitCurrent(files: Files, kitHome: string, current: KitCurrent): Promise<void> {
  const record = { [VERSION_FIELD]: KIT_CURRENT_FORMAT, ...current };
  await files.write(kitCurrentRecordPath(kitHome), `${JSON.stringify(record, null, 2)}\n`);
  await files.write(kitCurrentPath(kitHome), `${current.version}\n`);
}

/** The versions kept in `versions/`, newest first; a `.partial` copy and anything that is no release version left out. */
export async function listKitVersions(files: Pick<Files, 'list'>, kitHome: string): Promise<readonly string[]> {
  const kept = (await files.list(kitVersionsFolder(kitHome)))
    .map((name) => ({ name, version: parseVersion(name) }))
    .filter((entry): entry is { name: string; version: Version } => entry.version !== undefined);
  return kept.sort((a, b) => compareVersions(b.version, a.version)).map((entry) => entry.name);
}

/** The ports an install, a `use` and a prune take. */
export interface KitPorts {
  readonly files: Files;
  readonly tree: KitTree;
  readonly kitHome: string;
}

/**
 * The version folder's integrity list hash when every file in it matches the list, else why not. A release whose
 * plugin.json names another version is refused, so a folder's name is always the version it holds.
 */
async function verifiedListHash(files: Files, root: string, version: string): Promise<{ readonly hash: string } | { readonly why: string }> {
  const check = await checkClient(root, files);
  if (check.kind === 'no-manifest') {
    return { why: check.why };
  }
  if (check.kind === 'changed') {
    return { why: `files do not match ${CLIENT_MANIFEST}: ${check.paths.slice(0, 3).join(', ')}` };
  }
  const plugin = parseObject((await files.read(join(root, '.claude-plugin', 'plugin.json')))?.trim() ?? '');
  const named = plugin === undefined ? undefined : stringField(plugin, 'version');
  if (named !== version) {
    return { why: `.claude-plugin/plugin.json names version ${named ?? 'none'}, not ${version}` };
  }
  const list = (await files.read(join(root, CLIENT_MANIFEST))) ?? '';
  return { hash: clientFileHash(list) };
}

/** What an install did. */
export type KitInstallOutcome =
  /** The version is in use already; nothing was copied. */
  | { readonly kind: 'current'; readonly version: string }
  /** The version was copied in if it was missing, and `current` now names it. */
  | { readonly kind: 'installed'; readonly version: string; readonly previous?: string }
  /** The version's folder is kept, but `current` stays where `teamrig use` pinned it. */
  | { readonly kind: 'pinned'; readonly version: string; readonly pinned: string }
  /** The version's folder is kept, but `current` names a newer one, which an install never moves down. */
  | { readonly kind: 'older'; readonly version: string; readonly current: string }
  /** Another process holds the install lock; it does the same work. */
  | { readonly kind: 'busy' }
  /** Nothing moved: `current` still names what it named. */
  | { readonly kind: 'refused'; readonly why: string };

/** One install: the folder to copy, the version it holds and where it came from. */
export interface KitInstall extends KitPorts {
  readonly from: string;
  readonly version: string;
  readonly source: KitSource;
  /** The kit home's install lock, which a waiter never waits on: two installs at once would copy into one `.partial`. */
  readonly lock: Mutex;
}

/**
 * Installs the release in `from` as `versions/<version>/` when it is missing, damaged or partly copied, and moves
 * `current` to it unless a pin holds it or it names a newer version; then removes versions past the rollback window. A
 * copy that fails partway is removed and leaves `current` untouched. It never throws for a failed copy.
 */
export async function installKitVersion(install: KitInstall): Promise<KitInstallOutcome> {
  const { files, kitHome, version } = install;
  const wanted = parseVersion(version);
  if (wanted === undefined) {
    return { kind: 'refused', why: `${version} is no release version` };
  }
  const before = await readKitCurrent(files, kitHome);
  if (before?.version === version && (await files.read(join(kitVersionFolder(kitHome, version), CLIENT_MANIFEST))) !== undefined) {
    return { kind: 'current', version };
  }
  try {
    return await install.lock.run(() => installUnderLock(install, wanted));
  } catch (error) {
    if (error instanceof LockBusyError) {
      return { kind: 'busy' };
    }
    throw error;
  }
}

async function installUnderLock(install: KitInstall, wanted: Version): Promise<KitInstallOutcome> {
  const { files, tree, kitHome, version, source } = install;
  const folder = kitVersionFolder(kitHome, version);
  let verified = await verifiedListHash(files, folder, version);
  if ('why' in verified) {
    const partial = `${folder}.partial`;
    try {
      await tree.removeFolder(partial);
      await tree.copyFolder(install.from, partial);
      verified = await verifiedListHash(files, partial, version);
      if ('why' in verified) {
        await tree.removeFolder(partial);
        return { kind: 'refused', why: `the copy of ${version} is not whole: ${verified.why}` };
      }
      await tree.removeFolder(folder);
      await files.move(partial, folder);
      await files.write(sourcePath(kitHome, version), `${JSON.stringify(source)}\n`);
    } catch (error) {
      await tree.removeFolder(partial).catch(() => undefined);
      return { kind: 'refused', why: `copying ${version} failed: ${errorMessage(error)}` };
    }
  }
  const before = await readKitCurrent(files, kitHome);
  const outcome = await movedCurrent(files, kitHome, before, { version, listHash: verified.hash, source, pinned: false }, wanted);
  await pruneKitVersions(install);
  return outcome;
}

async function movedCurrent(files: Files, kitHome: string, before: KitCurrent | undefined, next: KitCurrent, wanted: Version): Promise<KitInstallOutcome> {
  const version = next.version;
  if (before?.version === version) {
    if (before.listHash !== next.listHash) {
      await writeKitCurrent(files, kitHome, { ...next, pinned: before.pinned });
    }
    return { kind: 'current', version };
  }
  if (before?.pinned === true) {
    return { kind: 'pinned', version, pinned: before.version };
  }
  const was = before === undefined ? undefined : parseVersion(before.version);
  if (before !== undefined && was !== undefined && compareVersions(was, wanted) > 0) {
    return { kind: 'older', version, current: before.version };
  }
  await writeKitCurrent(files, kitHome, next);
  return before === undefined ? { kind: 'installed', version } : { kind: 'installed', version, previous: before.version };
}

/** Which version `teamrig use` moves to: one named, which pins it, or the newest kept, which clears the pin. */
export type KitUseTarget = { readonly kind: 'version'; readonly version: string } | { readonly kind: 'latest' };

/** What `teamrig use` did. */
export type KitUseOutcome =
  | { readonly kind: 'moved'; readonly version: string; readonly previous?: string; readonly pinned: boolean }
  | { readonly kind: 'refused'; readonly why: string };

/** Moves `current` to a kept version whose files match its list: a named one pinned, the newest kept with no pin. */
export async function useKitVersion(ports: KitPorts, target: KitUseTarget): Promise<KitUseOutcome> {
  const { files, kitHome } = ports;
  const kept = await listKitVersions(files, kitHome);
  const version = target.kind === 'latest' ? kept[0] : target.version;
  if (version === undefined) {
    return { kind: 'refused', why: 'no version is installed in the kit home; a session start of the teamrig plugin installs one' };
  }
  if (!kept.includes(version)) {
    return { kind: 'refused', why: `${version} is not installed; kept: ${kept.join(', ') || 'none'}` };
  }
  const verified = await verifiedListHash(files, kitVersionFolder(kitHome, version), version);
  if ('why' in verified) {
    return { kind: 'refused', why: `${version} is damaged (${verified.why}); install it again` };
  }
  const source = sourceOf(parseObject((await files.read(sourcePath(kitHome, version)))?.trim() ?? '')) ?? { kind: 'claude-code-plugin' };
  const before = await readKitCurrent(files, kitHome);
  const pinned = target.kind === 'version';
  await writeKitCurrent(files, kitHome, { version, listHash: verified.hash, source, pinned });
  return before === undefined || before.version === version ? { kind: 'moved', version, pinned } : { kind: 'moved', version, previous: before.version, pinned };
}

/** What a prune removed, and the versions whose removal failed (a running process holds a file), left for the next. */
export interface KitPruneOutcome {
  readonly removed: readonly string[];
  readonly failed: readonly string[];
}

/**
 * Removes the kept versions past the rollback window: it keeps the version `current` names, every newer one (a pinned
 * install's way back up) and the `KEPT_OLDER_VERSIONS` newest older ones. With no `current`, it removes nothing.
 */
export async function pruneKitVersions(ports: KitPorts): Promise<KitPruneOutcome> {
  const { files, tree, kitHome } = ports;
  const current = await readKitCurrent(files, kitHome);
  const inUse = current === undefined ? undefined : parseVersion(current.version);
  if (current === undefined || inUse === undefined) {
    return { removed: [], failed: [] };
  }
  const older = (await listKitVersions(files, kitHome)).filter((name) => {
    const version = parseVersion(name);
    return version !== undefined && compareVersions(version, inUse) < 0;
  });
  const removed: string[] = [];
  const failed: string[] = [];
  for (const version of older.slice(KEPT_OLDER_VERSIONS)) {
    try {
      await tree.removeFolder(kitVersionFolder(kitHome, version));
      await files.remove(sourcePath(kitHome, version));
      removed.push(version);
    } catch {
      failed.push(version);
    }
  }
  return { removed, failed };
}
