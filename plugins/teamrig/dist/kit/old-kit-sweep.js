import { join } from 'node:path';
import { treeOf } from "../delivery/processes.js";
import { readKitCurrent } from "./kit-versions.js";
import { oldKitProcesses } from "./old-kit-processes.js";
/**
 * The sweep of what an older teamrig version left running after an update (T5813): its task pane watchers
 * (`events`) and UIs (`ui`), matched by entry path and version alone (old-kit-processes.ts), each ended with every
 * process it started. Only the version `<kit home>/current` names sweeps, so an old version never ends a newer one's.
 */
/** How often a hook may start a sweep: an old tab's pane starts its watcher again, and that one ends within this. */
export const OLD_KIT_SWEEP_EVERY_MS = 10 * 60_000;
/** When a hook last started a sweep, in ms since 1970: `<kit home>/restore/old-kit-sweep.at`. */
export function oldKitSweepStampPath(kitHome) {
    return join(kitHome, 'restore', 'old-kit-sweep.at');
}
/**
 * Whether a hook should start a sweep now, and if so marks it started: no stamp, an unreadable one, one
 * `OLD_KIT_SWEEP_EVERY_MS` old, or one in the future (a clock moved back). Two hooks at once may both start one; the
 * second finds nothing left to end.
 */
export async function claimOldKitSweep(files, kitHome, now) {
    const path = oldKitSweepStampPath(kitHome);
    const text = (await files.read(path))?.trim();
    const at = text === undefined || !/^\d+$/.test(text) ? undefined : Number(text);
    if (at !== undefined && at <= now && now - at < OLD_KIT_SWEEP_EVERY_MS) {
        return false;
    }
    await files.write(path, `${now}\n`);
    return true;
}
/**
 * What a sweep would end: each process an older version runs `events` or `ui` in, with its tree. A tree that holds
 * this process (one of its starters) is left out.
 */
export async function planOldKitSweep(ports) {
    const current = (await readKitCurrent(ports.files, ports.kitHome))?.version;
    if (current !== ports.running) {
        return { kind: 'not-current', current };
    }
    const listed = await ports.processes.list();
    if (listed === undefined) {
        return { kind: 'unlisted' };
    }
    const rows = listed.map(linkOf);
    const matches = oldKitProcesses(listed.map(({ info }) => ({ pid: info.pid, commandLine: info.commandLine })), { roots: ports.roots, current, platform: ports.platform });
    const targets = matches
        .map((match) => ({ ...match, tree: treeOf(match.pid, rows).map((row) => row.pid) }))
        .filter((target) => !target.tree.includes(ports.ownPid));
    return { kind: 'found', targets };
}
function linkOf({ info, startedMs }) {
    return startedMs === undefined ? { pid: info.pid, parent: info.parentPid } : { pid: info.pid, parent: info.parentPid, startedMs };
}
/**
 * Ends each target's tree, the target first so it starts no new child. On Windows ending the target ends its tree
 * (the start-checked sweep, session-processes.ts); elsewhere each pid of the tree is ended in turn. A pid that is gone
 * already counts as ended.
 */
export async function endOldKitTargets(ports, targets) {
    const ends = [];
    for (const target of targets) {
        const pids = ports.platform === 'win32' ? [target.pid] : target.tree;
        let failed;
        for (const pid of pids) {
            const outcome = await ports.processes.end(pid, 'force');
            if (outcome.kind === 'failed' && failed === undefined) {
                failed = `${pid}: ${outcome.error}`;
            }
        }
        ends.push({ target, failed });
    }
    return ends;
}
/** How a target is named: `old ui 47072 (0.504.0), tree 47072 51208`. */
export function oldKitTargetText(target) {
    return `old ${target.word} ${target.pid} (${target.version}), tree ${target.tree.join(' ')}`;
}
/** The restore log's line of one end: `kit: ended old ...`, or `kit: could not end old ...: <why>`. */
export function oldKitEndLine(end) {
    return end.failed === undefined ? `kit: ended ${oldKitTargetText(end.target)}` : `kit: could not end ${oldKitTargetText(end.target)}: ${end.failed}`;
}
