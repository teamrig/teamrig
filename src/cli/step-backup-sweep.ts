import type { KitConfig } from '../config/types.ts';
import { errorMessage } from '../core/guards.ts';
import { MS_PER_DAY, parseIsoStamp } from '../core/time.ts';
import { StepBackupLedger, type StepBackup } from '../steps/backups.ts';
import { fileLockOf } from './file-locks.ts';
import type { Kit } from './kit.ts';
import type { CliRuntime } from './runtime.ts';

/**
 * Whether `backup` is past `days` at `now`. A backup whose stamp cannot be read is never due: teamrig removes only
 * what it can show is old.
 */
export function backupDue(backup: StepBackup, now: number, days: number): boolean {
  const at = parseIsoStamp(backup.at);
  return at !== undefined && now - at.getTime() > days * MS_PER_DAY;
}

/**
 * Removes the step backups kept past `steps.backupDays`, only those the step ledger records. Its `lines` say so: a
 * count line naming the key, then each path removed; none when nothing was due. Never throws: a busy lock or a file
 * that cannot be removed is its `problem`, and the next start tries again.
 */
export async function sweepOldStepBackups(runtime: CliRuntime, kit: Kit, config: KitConfig): Promise<StepBackupSweep> {
  const days = config.steps.backupDays;
  const ledger = new StepBackupLedger(runtime.files, kit.paths.stepBackups, fileLockOf(runtime, kit.paths.stepBackupsLock, config.lock));
  const now = runtime.clock.now();
  try {
    const removed = await ledger.removeWhere((backup) => backupDue(backup, now, days));
    const lines = removed.length === 0 ? [] : [`CLEANED ${removed.length} step backup(s) older than ${days} days [steps.backupDays]`, ...removed.map((path) => `  ${path}`)];
    return { lines };
  } catch (error) {
    return { lines: [], problem: `the step backups older than ${days} days were not removed: ${errorMessage(error)}` };
  }
}

/** What one sweep of the step backups printed, and why it could not finish, if it could not. */
export interface StepBackupSweep {
  readonly lines: readonly string[];
  readonly problem?: string;
}
