import { join } from 'node:path';
import { isTemporaryName } from "../core/files.js";
import { errorMessage, isRecord, stringField } from "../core/guards.js";
import { parseObject, recordVersion, VERSION_FIELD } from "../core/jsonl.js";
import { LockBusyError } from "../core/lock.js";
import { compareVersions, parseVersion } from "../core/release-version.js";
import { checkClient, CLIENT_MANIFEST, clientFileHash } from "../exec/client-integrity.js";
import { cliLauncherPath } from "../restore/cli-launcher.js";
/**
 * teamrig's own install under the kit home (T5278, design D): one full copy of each release in `versions/<v>/`, and
 * the version in use named twice, by the one-line `current` the launcher reads first and by `current.json`, which adds
 * the sha256 of that version's integrity list, where it came from and whether `teamrig kit use` pinned it. Where a host's
 * hook line runs the kit home's fixed launcher (Codex CLI's, which `setup hooks` writes), the
 * launcher runs the version `current` names, so an upgrade only adds a folder and moves `current`, and the hook text a
 * host trusts never changes.
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
/**
 * How many versions newer than `current` a prune keeps: a pinned install's way back up, the newest only, so a pin held
 * for months does not keep every release a session start copied since.
 */
export const KEPT_NEWER_VERSIONS = 1;
/** The folders an install leaves beside `versions/<v>` when it stopped partway: its copy, or the old folder set aside. */
const LEFTOVER_FOLDER_SUFFIXES = ['.partial', '.replaced'];
/** The folder of every installed version: `<kit home>/versions`. */
export function kitVersionsFolder(kitHome) {
    return join(kitHome, 'versions');
}
/** One installed version's folder: `<kit home>/versions/<v>`. */
export function kitVersionFolder(kitHome, version) {
    return join(kitVersionsFolder(kitHome), version);
}
/** The one-line name of the version in use: `<kit home>/current`. */
export function kitCurrentPath(kitHome) {
    return join(kitHome, 'current');
}
/** The record of the version in use: `<kit home>/current.json`. */
export function kitCurrentRecordPath(kitHome) {
    return join(kitHome, 'current.json');
}
/** Where a kept version came from, beside its folder: `<kit home>/versions/<v>.source.json`. */
function sourcePath(kitHome, version) {
    return `${kitVersionFolder(kitHome, version)}.source.json`;
}
function sourceOf(value) {
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
function isListHash(value) {
    return /^[0-9a-f]{64}$/.test(value);
}
/**
 * The version in use as both records name it: `current` must be one release version (no path, no `..`), and
 * `current.json` must name that same version with a well-formed list hash. Only both records missing reads as none.
 */
export async function readKitCurrentState(files, kitHome) {
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
export async function readKitCurrent(files, kitHome) {
    const state = await readKitCurrentState(files, kitHome);
    return state.kind === 'current' ? state.current : undefined;
}
/** A kept version's source record, or undefined when it is missing or malformed. */
async function readKeptSource(files, kitHome, version) {
    const record = parseObject((await files.read(sourcePath(kitHome, version)))?.trim() ?? '');
    if (record === undefined) {
        return undefined;
    }
    const source = sourceOf(record['source']);
    const listHash = stringField(record, 'listHash');
    return source === undefined || listHash === undefined || !isListHash(listHash) ? undefined : { source, listHash };
}
async function writeKeptSource(files, kitHome, version, kept) {
    await files.write(sourcePath(kitHome, version), `${JSON.stringify(kept)}\n`);
}
/** The sha256 of a folder's integrity list, read as `clientFileHash` reads it, or undefined with no list. */
async function listHashOf(files, root) {
    const list = await files.read(join(root, CLIENT_MANIFEST));
    return list === undefined ? undefined : clientFileHash(list);
}
/** Writes `current.json`, then `current`, each by temp file and rename. */
async function writeKitCurrent(files, kitHome, current) {
    const record = { [VERSION_FIELD]: KIT_CURRENT_FORMAT, ...current };
    await files.write(kitCurrentRecordPath(kitHome), `${JSON.stringify(record, null, 2)}\n`);
    await files.write(kitCurrentPath(kitHome), `${current.version}\n`);
}
/** The versions kept in `versions/`, newest first; a `.partial` copy and anything that is no release version left out. */
export async function listKitVersions(files, kitHome) {
    const kept = (await files.list(kitVersionsFolder(kitHome)))
        .map((name) => ({ name, version: parseVersion(name) }))
        .filter((entry) => entry.version !== undefined);
    return kept.sort((a, b) => compareVersions(b.version, a.version)).map((entry) => entry.name);
}
/** Why `teamrig kit use` or `teamrig kit prune` changed nothing while another process held the install lock. */
export const KIT_LOCK_BUSY = 'another teamrig process holds the kit install lock (a session start copying a release); retry';
/** The task's result under `lock`, or busy when another process held the lock past the lock's wait. */
async function underLock(lock, task) {
    try {
        return { kind: 'done', result: await lock.run(task) };
    }
    catch (error) {
        if (error instanceof LockBusyError) {
            return { kind: 'busy' };
        }
        throw error;
    }
}
/**
 * The version folder's integrity list hash when every file in it matches the list, else why not. A release whose
 * plugin.json names another version is refused, so a folder's name is always the version it holds.
 */
async function verifiedListHash(files, root, version) {
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
/**
 * Installs the release in `from` as `versions/<version>/` when it is missing, damaged or partly copied, and moves
 * `current` to it unless a pin holds it or it names a newer version; then removes versions past the rollback window. A
 * copy that fails partway is removed and leaves `current` untouched. It never throws for a failed copy.
 */
export async function installKitVersion(install) {
    const { version } = install;
    const wanted = parseVersion(version);
    if (wanted === undefined) {
        return { kind: 'refused', why: `${version} is no release version` };
    }
    const settled = await settledWithoutLock(install, wanted);
    if (settled !== undefined) {
        return settled;
    }
    const held = await underLock(install.lock, () => installUnderLock(install, wanted));
    return held.kind === 'done' ? held.result : held;
}
/**
 * What an install that changes nothing returns, read without the lock: the kept copy's integrity list and its source
 * record match the running client's list, every kept file matches that list, and `current` names this version with
 * that list hash, or a pin or a newer version holds it. Undefined when anything differs, so the install goes under the
 * lock, which copies a damaged version again by moves. A session start of a pinned or older plugin so never waits on
 * another start's copy, and a damaged kept copy (current, pinned or older) is whole again after the next start: the
 * launcher refuses a damaged current, so no other step would ever repair it.
 */
async function settledWithoutLock(install, wanted) {
    const { files, kitHome, version } = install;
    const state = await readKitCurrentState(files, kitHome);
    const running = await listHashOf(files, install.from);
    if (state.kind !== 'current' || running === undefined) {
        return undefined;
    }
    const folder = kitVersionFolder(kitHome, version);
    const kept = await listHashOf(files, folder);
    if (kept !== running || (await readKeptSource(files, kitHome, version))?.listHash !== running) {
        return undefined;
    }
    if ((await checkClient(folder, files)).kind !== 'intact') {
        return undefined;
    }
    const { current } = state;
    if (current.version === version) {
        return current.listHash === running ? { kind: 'current', version } : undefined;
    }
    if (current.pinned) {
        return { kind: 'pinned', version, pinned: current.version };
    }
    const was = parseVersion(current.version);
    return was !== undefined && compareVersions(was, wanted) > 0 ? { kind: 'older', version, current: current.version } : undefined;
}
async function installUnderLock(install, wanted) {
    const { files, tree, kitHome, version, source } = install;
    const state = await readKitCurrentState(files, kitHome);
    if (state.kind === 'disagree') {
        return { kind: 'refused', why: 'the records naming the version in use disagree or one is missing; teamrig kit use <version> names one' };
    }
    const running = await listHashOf(files, install.from);
    if (running === undefined) {
        return { kind: 'refused', why: `the release to copy has no ${CLIENT_MANIFEST}` };
    }
    const otherBuild = { kind: 'refused', why: `${version} is kept from another build than the running client (its ${CLIENT_MANIFEST} differs)` };
    const folder = kitVersionFolder(kitHome, version);
    const kept = await readKeptSource(files, kitHome, version);
    if (kept !== undefined && kept.listHash !== running) {
        return otherBuild;
    }
    let verified = await verifiedListHash(files, folder, version);
    if ('hash' in verified && verified.hash !== running && kept === undefined) {
        return otherBuild;
    }
    if ('hash' in verified && verified.hash === running) {
        if (kept === undefined) {
            await writeKeptSource(files, kitHome, version, { source, listHash: verified.hash });
        }
    }
    else {
        const partial = `${folder}.partial`;
        try {
            await tree.removeFolder(partial);
            await tree.copyFolder(install.from, partial);
            verified = await verifiedListHash(files, partial, version);
            if ('why' in verified) {
                await tree.removeFolder(partial);
                return { kind: 'refused', why: `the copy of ${version} is not whole: ${verified.why}` };
            }
            if (verified.hash !== running) {
                await tree.removeFolder(partial);
                return { kind: 'refused', why: `the release of ${version} changed while it was copied` };
            }
            await replacedFolder(install, partial, folder);
            await writeKeptSource(files, kitHome, version, { source, listHash: verified.hash });
        }
        catch (error) {
            await tree.removeFolder(partial).catch(() => undefined);
            return { kind: 'refused', why: `copying ${version} failed: ${errorMessage(error)}` };
        }
    }
    const before = state.kind === 'current' ? state.current : undefined;
    const outcome = await movedCurrent(files, kitHome, before, { version, listHash: verified.hash, source, pinned: false }, wanted);
    await prunedUnderLock(install);
    return outcome;
}
/**
 * Puts the whole copy in `partial` at `folder` by moves only, so a launcher reading `folder` finds the old copy or the
 * new one, never a half-removed tree: the old folder moves aside to `<v>.replaced`, the copy moves in, and the old one
 * is removed after. A failed move-in puts the old folder back; a `.replaced` a running process holds is left for a
 * prune.
 */
async function replacedFolder(ports, partial, folder) {
    const { files, tree } = ports;
    const replaced = `${folder}.replaced`;
    await tree.removeFolder(replaced);
    const hadFolder = await files.move(folder, replaced);
    try {
        await files.move(partial, folder);
    }
    catch (error) {
        if (hadFolder) {
            await files.move(replaced, folder).catch(() => false);
        }
        throw error;
    }
    if (hadFolder) {
        await tree.removeFolder(replaced).catch(() => undefined);
    }
}
async function movedCurrent(files, kitHome, before, next, wanted) {
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
/**
 * How a refusal of `teamrig kit use` names the way to a whole copy: the next install of that version finds its files
 * off their list, or its source record gone, and copies it again.
 */
const RECOPY = 'the next session start of the teamrig plugin at that version copies it again';
/** Why a preview of `teamrig kit use` refuses a damaged version, naming the write that gets it copied again. */
export function damagedPreviewWhy(plan) {
    return `${plan.version} is damaged (${plan.why}); with --yes, teamrig kit use drops its source record, so ${RECOPY}`;
}
/**
 * Where `teamrig kit use` would move `current`, writing nothing: a named kept version pinned, or the newest kept with no
 * pin, and only one whose files match its integrity list.
 */
export async function planKitUse(ports, target) {
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
        return { kind: 'damaged', version, why: verified.why };
    }
    const record = await readKeptSource(files, kitHome, version);
    if (record === undefined) {
        return { kind: 'refused', why: `${version} has no record of where it came from (${version}.source.json); ${RECOPY}` };
    }
    if (record.listHash !== verified.hash) {
        return { kind: 'refused', why: `${version} is not the build it was copied from (its ${CLIENT_MANIFEST} differs)` };
    }
    const next = { version, listHash: verified.hash, source: record.source, pinned: target.kind === 'version' };
    const previous = await readKitCurrent(files, kitHome);
    return previous === undefined ? { kind: 'move', next } : { kind: 'move', next, previous };
}
/**
 * Moves `current` as `planKitUse` plans it, checking and writing under the install lock, so a session start's install
 * never rewrites the records between them and a prune never removes the version it checked. Refused while another
 * process holds the lock past its wait.
 */
export async function useKitVersion(ports, target) {
    const held = await underLock(ports.lock, () => usedUnderLock(ports, target));
    return held.kind === 'done' ? held.result : { kind: 'refused', why: KIT_LOCK_BUSY };
}
async function usedUnderLock(ports, target) {
    const plan = await planKitUse(ports, target);
    if (plan.kind === 'refused') {
        return plan;
    }
    if (plan.kind === 'damaged') {
        // A start of this version settles on its intact list and record without hashing the files, so it would never
        // copy the damaged files again; with the record gone it goes under the lock, which verifies them and recopies.
        await ports.files.remove(sourcePath(ports.kitHome, plan.version));
        return { kind: 'refused', why: `${plan.version} is damaged (${plan.why}); its source record is dropped, so ${RECOPY}` };
    }
    const { next, previous } = plan;
    await writeKitCurrent(ports.files, ports.kitHome, next);
    const moved = { kind: 'moved', version: next.version, pinned: next.pinned };
    return previous === undefined || previous.version === next.version ? moved : { ...moved, previous: previous.version };
}
/**
 * The kept versions past the rollback window, newest first, which a prune removes: all but the version `current` names,
 * the `KEPT_NEWER_VERSIONS` newest newer ones (a pinned install's way back up) and the `KEPT_OLDER_VERSIONS` newest
 * older ones. None with no `current`.
 */
export async function prunableKitVersions(files, kitHome) {
    const current = await readKitCurrent(files, kitHome);
    const inUse = current === undefined ? undefined : parseVersion(current.version);
    if (inUse === undefined) {
        return [];
    }
    const kept = await listKitVersions(files, kitHome);
    const sideOf = (name) => {
        const version = parseVersion(name);
        return version === undefined ? 0 : compareVersions(version, inUse);
    };
    const newer = kept.filter((name) => sideOf(name) > 0);
    const older = kept.filter((name) => sideOf(name) < 0);
    return [...newer.slice(KEPT_NEWER_VERSIONS), ...older.slice(KEPT_OLDER_VERSIONS)];
}
/** Whether a name in `versions/` is a stopped install's folder for a release version: `<v>.partial` or `<v>.replaced`. */
function isLeftoverFolderName(name) {
    return LEFTOVER_FOLDER_SUFFIXES.some((suffix) => name.endsWith(suffix) && parseVersion(name.slice(0, -suffix.length)) !== undefined);
}
/**
 * What stopped installs and writes left in the kit home, which a prune removes: `versions/<v>.partial` and
 * `versions/<v>.replaced` folders, temp files in `versions/`, and the temp siblings of `current` and `current.json`.
 * Only teamrig's own names: nothing else in the kit home is touched.
 */
export async function kitLeftovers(files, kitHome) {
    const inVersions = (await files.list(kitVersionsFolder(kitHome))).flatMap((name) => {
        const path = join('versions', name);
        if (isLeftoverFolderName(name)) {
            return [{ kind: 'folder', path }];
        }
        return isTemporaryName(name) ? [{ kind: 'file', path }] : [];
    });
    const inHome = (await files.list(kitHome))
        .filter((name) => name.startsWith('current.') && isTemporaryName(name))
        .map((name) => ({ kind: 'file', path: name }));
    return [...inVersions, ...inHome];
}
/**
 * Removes the versions `prunableKitVersions` names and the leftovers `kitLeftovers` finds, under the install lock, so
 * it never removes a version `teamrig kit use` just checked nor a copy a session start is putting in place.
 */
export async function pruneKitVersions(ports) {
    const held = await underLock(ports.lock, () => prunedUnderLock(ports));
    return held.kind === 'done' ? held.result : held;
}
/** The prune itself, for a caller holding the install lock already: an install after it moved `current`. */
async function prunedUnderLock(ports) {
    const { files, tree, kitHome } = ports;
    const removed = [];
    const leftovers = [];
    const failed = [];
    for (const version of await prunableKitVersions(files, kitHome)) {
        try {
            await tree.removeFolder(kitVersionFolder(kitHome, version));
            await files.remove(sourcePath(kitHome, version));
            removed.push(version);
        }
        catch {
            failed.push(version);
        }
    }
    for (const leftover of await kitLeftovers(files, kitHome)) {
        const path = join(kitHome, leftover.path);
        try {
            await (leftover.kind === 'folder' ? tree.removeFolder(path) : files.remove(path));
            leftovers.push(leftover.path);
        }
        catch {
            failed.push(leftover.path);
        }
    }
    return { kind: 'pruned', removed, leftovers, failed };
}
/** The files `kit uninstall` removes before the versions folder: the launcher first, so no line runs a half-removed kit. */
function installFilePaths(kitHome) {
    return [cliLauncherPath(kitHome), kitCurrentPath(kitHome), kitCurrentRecordPath(kitHome)];
}
/** The parts of teamrig's install the kit home holds now. */
export async function kitInstallParts(files, kitHome) {
    const present = [];
    for (const path of installFilePaths(kitHome)) {
        if ((await files.read(path)) !== undefined)
            present.push(path);
    }
    return { versions: await listKitVersions(files, kitHome), files: present };
}
/**
 * Removes teamrig's install from the kit home under the install lock, so a session start copying a release in never
 * leaves half of one behind: the launcher, then `current` and `current.json`, then the versions folder.
 */
export async function uninstallKit(ports) {
    const held = await underLock(ports.lock, async () => {
        const { files, tree, kitHome } = ports;
        const removed = [];
        const failed = [];
        for (const path of installFilePaths(kitHome)) {
            try {
                if (await files.remove(path))
                    removed.push(path);
            }
            catch {
                failed.push(path);
            }
        }
        const folder = kitVersionsFolder(kitHome);
        if ((await files.list(folder)).length > 0) {
            try {
                await tree.removeFolder(folder);
                removed.push(folder);
            }
            catch {
                failed.push(folder);
            }
        }
        return { kind: 'uninstalled', removed, failed };
    });
    return held.kind === 'done' ? held.result : held;
}
