import { errorMessage } from "../core/guards.js";
import { MS_PER_DAY, parseIsoStamp } from "../core/time.js";
import { StepBackupLedger } from "../steps/backups.js";
import { isStepBackupFile } from "../steps/pending.js";
import { fileLockOf } from "./file-locks.js";
/**
 * Whether `backup` is past `days` at `now`. A backup whose stamp cannot be read is never due: teamrig removes only
 * what it can show is old.
 */
export function backupDue(backup, now, days) {
    const at = parseIsoStamp(backup.at);
    return at !== undefined && now - at.getTime() > days * MS_PER_DAY;
}
/**
 * Removes the step backups kept past `steps.backupDays`, only those the step ledger records. Its `lines` say so: a
 * count line naming the key, then each path removed; none when nothing was due. Never throws: a busy lock or a file
 * that cannot be removed is its `problem`, and the next start tries again.
 */
export async function sweepOldStepBackups(runtime, kit, config) {
    const days = config.steps.backupDays;
    const ledger = stepBackupLedgerOf(runtime, kit, config);
    const now = runtime.clock.now();
    try {
        const { removed, refused } = await ledger.removeWhere((backup) => backupDue(backup, now, days));
        const lines = removed.length === 0 ? [] : [`CLEANED ${removed.length} step backup(s) older than ${days} days [steps.backupDays]`, ...removed.map((path) => `  ${path}`)];
        return { lines, warnings: refused.map(refusedBackupLine) };
    }
    catch (error) {
        return { lines: [], warnings: [], problem: `the step backups older than ${days} days were not removed: ${errorMessage(error)}` };
    }
}
/** The team's step backup ledger, under its lock, removing only step backups in the team's backups folder. */
export function stepBackupLedgerOf(runtime, kit, config) {
    return new StepBackupLedger(runtime.files, kit.paths.stepBackups, fileLockOf(runtime, kit.paths.stepBackupsLock, config.lock), {
        folder: kit.paths.backups,
        isBackupFile: isStepBackupFile,
    });
}
/** Says a ledger row was left alone and dropped, as its path is not a step backup in the backups folder. */
export function refusedBackupLine(path) {
    return `the step backup ledger named ${path}, which is not a step backup in the backups folder; left it and dropped its row`;
}
