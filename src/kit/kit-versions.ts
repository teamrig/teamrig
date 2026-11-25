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
 * the sha256 of that version's integrity list, where it came from and whether `teamrig kit use` pinned it. Every host's
 * hook line runs the kit home's fixed launcher, which runs the version `current` names, so an upgrade only adds a folder
 * and moves `current`, and the hook text a host trusts never changes.
 *
 * A copy goes to `versions/<v>.partial/` first and is renamed to `<v>/` only once every file matches its integrity
 * list, so a half-copied version is never one `current` names. Both records are written by temp file and rename. A pin
 * keeps `current` where `teamrig kit use` put it: an install of a newer version adds its folder and moves nothing, or the
 * next session start of a newer plugin would undo a rollback.
 *
 * Every change to `current` or to the kept folders (an install, `teamrig kit use`, `teamrig kit prune`) runs under the
 * kit home's install lock, so none reads `current` while another rewrites it. Records that disagree, or only one of
 * them, never read as a first install: an install then moves nothing until `teamrig kit use` names a version. A kept
 * version is the build it was copied from: a client of the same version with another integrity list is refused.
 */

/** `current.json`'s format; a field added to it raises this. */
export const KIT_CURRENT_FORMAT = 1;

/** How many versions older than `current` an install keeps, so `teamrig kit use` can roll back to them. */
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
  /** Set by `teamrig kit use <v>`: an install leaves `current` alone until `teamrig kit use --latest`. */
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

/** What the two records say about the version in use. */
export type KitCurrentState =
  /** Neither record is there: no version was ever named, so an install may name one. */
  | { readonly kind: 'none' }
  | { readonly kind: 'current'; readonly current: KitCurrent }
  /** Only one record is there, one is malformed, or they name different versions: an install moves nothing. */
  | { readonly kind: 'disagree' };

function isListHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * The version in use as both records name it: `current` must be one release version (no path, no `..`), and
 * `current.json` must name that same version with a well-formed list hash. Only both records missing reads as none.
 */
export async function readKitCurrentState(files: Pick<Files, 'read'>, kitHome: string): Promise<KitCurrentState> {
  const line = (await files.read(kitCurrentPath(kitHome)))?.trim();
  const text = await files.read(kitCurrentRecordPath(kitHome));
  if (line === undefined && text === undefined) {
    return { kind: 'none' };
  }
  const record = text === undefined ? undefined : parseObject(text.trim());
  if (line === undefined || parseVersion(line) === undefined || record === undefined || recordVersion(record) !== KIT_CURRENT_FORMAT) {
    return { kind: 'disagree' };
  }
  const listHash = stringField(record, 'listHash');
  const source = sourceOf(record['source']);
  const pinned = record['pinned'];
  if (stringField(record, 'version') !== line || listHash === undefined || !isListHash(listHash) || source === undefined || typeof pinned !== 'boolean') {
    return { kind: 'disagree' };
  }
  return { kind: 'current', current: { version: line, listHash, source, pinned } };
}

/** The version in use, or undefined when there is none or the two records disagree (readKitCurrentState). */
export async function readKitCurrent(files: Pick<Files, 'read'>, kitHome: string): Promise<KitCurrent | undefined> {
  const state = await readKitCurrentState(files, kitHome);
  return state.kind === 'current' ? state.current : undefined;
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
  /** The version's folder is kept, but `current` stays where `teamrig kit use` pinned it. */
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
  const state = await readKitCurrentState(files, kitHome);
  if (state.kind === 'disagree') {
    return { kind: 'refused', why: 'the records naming the version in use disagree or one is missing; teamrig kit use <version> names one' };
  }
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
  const before = state.kind === 'current' ? state.current : undefined;
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

/** Which version `teamrig kit use` moves to: one named, which pins it, or the newest kept, which clears the pin. */
export type KitUseTarget = { readonly kind: 'version'; readonly version: string } | { readonly kind: 'latest' };

/** Where `teamrig kit use` would move `current`, or why it would not. */
export type KitUsePlan =
  | { readonly kind: 'move'; readonly next: KitCurrent; readonly previous?: KitCurrent }
  | { readonly kind: 'refused'; readonly why: string };

/** What `teamrig kit use` did. */
export type KitUseOutcome =
  | { readonly kind: 'moved'; readonly version: string; readonly previous?: string; readonly pinned: boolean }
  | { readonly kind: 'refused'; readonly why: string };

/**
 * Where `teamrig kit use` would move `current`, writing nothing: a named kept version pinned, or the newest kept with no
 * pin, and only one whose files match its integrity list.
 */
export async function planKitUse(ports: Pick<KitPorts, 'files' | 'kitHome'>, target: KitUseTarget): Promise<KitUsePlan> {
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
  const next: KitCurrent = { version, listHash: verified.hash, source, pinned: target.kind === 'version' };
  const previous = await readKitCurrent(files, kitHome);
  return previous === undefined ? { kind: 'move', next } : { kind: 'move', next, previous };
}

/** Moves `current` as `planKitUse` plans it. */
export async function useKitVersion(ports: Pick<KitPorts, 'files' | 'kitHome'>, target: KitUseTarget): Promise<KitUseOutcome> {
  const plan = await planKitUse(ports, target);
  if (plan.kind === 'refused') {
    return plan;
  }
  const { next, previous } = plan;
  await writeKitCurrent(ports.files, ports.kitHome, next);
  const moved = { kind: 'moved', version: next.version, pinned: next.pinned } as const;
  return previous === undefined || previous.version === next.version ? moved : { ...moved, previous: previous.version };
}

/** What a prune removed, and the versions whose removal failed (a running process holds a file), left for the next. */
export interface KitPruneOutcome {
  readonly removed: readonly string[];
  readonly failed: readonly string[];
}

/**
 * The kept versions past the rollback window, newest first, which a prune removes: all but the version `current` names,
 * every newer one (a pinned install's way back up) and the `KEPT_OLDER_VERSIONS` newest older ones. None with no
 * `current`.
 */
export async function prunableKitVersions(files: Pick<Files, 'read' | 'list'>, kitHome: string): Promise<readonly string[]> {
  const current = await readKitCurrent(files, kitHome);
  const inUse = current === undefined ? undefined : parseVersion(current.version);
  if (inUse === undefined) {
    return [];
  }
  const older = (await listKitVersions(files, kitHome)).filter((name) => {
    const version = parseVersion(name);
    return version !== undefined && compareVersions(version, inUse) < 0;
  });
  return older.slice(KEPT_OLDER_VERSIONS);
}

/** Removes the versions `prunableKitVersions` names. */
export async function pruneKitVersions(ports: KitPorts): Promise<KitPruneOutcome> {
  const { files, tree, kitHome } = ports;
  const removed: string[] = [];
  const failed: string[] = [];
  for (const version of await prunableKitVersions(files, kitHome)) {
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
