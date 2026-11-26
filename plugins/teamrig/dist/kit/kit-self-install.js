import { isAbsolute, join, relative } from 'node:path';
import { CLIENT_MANIFEST } from "../exec/client-integrity.js";
import { installKitVersion, kitVersionsFolder } from "./kit-versions.js";
/**
 * The kit home's install lock as a session start takes it: never waited on, since a start that finds it held leaves
 * the copy to the start holding it. Its TTL outlasts a slow copy of a release (about 6 MB) to a busy disk.
 */
export const KIT_INSTALL_LOCK = { ttlMs: 300_000, pollMs: 50, waitMs: 0 };
/**
 * The install lock as `teamrig kit use` and `teamrig kit prune` take it: they wait up to 30 s, so a session start's
 * copy in progress delays the person's command rather than refusing it, and refuse past that.
 */
export const KIT_COMMAND_LOCK = { ttlMs: 300_000, pollMs: 100, waitMs: 30_000 };
/** The install lock: `<kit home>/versions.lock`, beside the folder it guards. */
export function kitInstallLockPath(kitHome) {
    return join(kitHome, 'versions.lock');
}
/** Whether `path` is `folder` or inside it. */
function isWithin(folder, path) {
    const rel = relative(folder, path);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
/**
 * Copies the running client into `versions/<version>` and names it current (kit-versions.ts), so a host whose hooks
 * run from the kit home runs this version next: at a session start, and by `teamrig kit install`. It copies only the client's own root, which is why
 * it runs with no exec guard. A client running from the kit's versions folder copies nothing: it is installed already.
 */
export async function installRunningKit(install) {
    const { files, kitHome, clientRoot } = install;
    if (isWithin(kitVersionsFolder(kitHome), clientRoot)) {
        return { kind: 'skipped', why: 'runs-from-kit' };
    }
    if ((await files.read(join(clientRoot, CLIENT_MANIFEST))) === undefined) {
        return { kind: 'skipped', why: 'no-integrity-list' };
    }
    return installKitVersion({ ...install, from: clientRoot });
}
/**
 * The session-start note of an install that left `current` elsewhere, named each time so it is never silent: a pin, or
 * an older plugin (a move from the preview channel back to stable) whose version an install never moves down to;
 * else undefined.
 */
export function kitSelfInstallNote(outcome) {
    return outcome.kind === 'pinned' || outcome.kind === 'older' ? keptAsideNote(outcome) : undefined;
}
/** Why `current` stays where it is after a kept-aside install, and the `teamrig kit use` line that moves it. */
export function keptAsideNote(outcome) {
    return outcome.kind === 'pinned'
        ? `teamrig pinned at ${outcome.pinned}; ${outcome.version} is installed; \`teamrig kit use --latest\` moves to it.`
        : `teamrig ${outcome.current} stays current; this plugin's ${outcome.version} is older and kept; \`teamrig kit use ${outcome.version}\` moves to it.`;
}
/** The restore log's line for a self-copy that changed or refused something; undefined for one that did nothing. */
export function kitSelfInstallLogLine(outcome) {
    switch (outcome.kind) {
        case 'installed':
            return `kit: ${outcome.previous ?? 'none'} -> ${outcome.version}: current`;
        case 'pinned':
            return `kit: ${outcome.version} kept; current pinned at ${outcome.pinned}`;
        case 'older':
            return `kit: ${outcome.version} kept; current ${outcome.current} is newer`;
        case 'refused':
            return `kit: refused: ${outcome.why}`;
        case 'skipped':
        case 'current':
        case 'busy':
            return undefined;
    }
}
