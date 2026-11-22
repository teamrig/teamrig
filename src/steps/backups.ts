import type { Files } from '../core/files.ts';
import { stringField } from '../core/guards.ts';
import { parseJsonl, toJsonlLine, VERSION_FIELD } from '../core/jsonl.ts';
import type { Mutex } from '../core/lock.ts';

/** One backup a step took before it ran: the step's id, the backup's path and when it was taken (an ISO stamp). */
export interface StepBackup {
  readonly step: string;
  readonly path: string;
  readonly at: string;
}

const LEDGER_VERSION = 1;

/**
 * The ledger of the backups steps took. A backup is temporary: it goes once the same step's next run succeeds, or
 * once it is past its age. Only a path written here is ever removed, so a file the person put beside the backups, or
 * a backup taken another way, stays.
 */
export class StepBackupLedger {
  private readonly files: Files;
  private readonly path: string;
  private readonly mutex: Mutex;

  constructor(files: Files, path: string, mutex: Mutex) {
    this.files = files;
    this.path = path;
    this.mutex = mutex;
  }

  /** Every backup on record, oldest first; a damaged line is skipped. */
  async read(): Promise<StepBackup[]> {
    const { records } = parseJsonl((await this.files.read(this.path)) ?? '');
    return records.flatMap(({ record }) => {
      const [step, path, at] = [stringField(record, 'step'), stringField(record, 'path'), stringField(record, 'at')];
      return step === undefined || path === undefined || at === undefined ? [] : [{ step, path, at }];
    });
  }

  /**
   * Records `backup` as its step's newest and removes the step's earlier backups, which the run that took it made
   * stale. Returns the paths removed.
   */
  async replace(backup: StepBackup): Promise<string[]> {
    return this.mutex.run(async () => {
      const earlier = (await this.read()).filter((row) => row.step === backup.step && row.path !== backup.path);
      const removed = await this.removeAll(earlier);
      await this.keepAllBut(earlier);
      const current = (await this.files.read(this.path)) ?? '';
      const separator = current === '' || current.endsWith('\n') ? '' : '\n';
      await this.files.append(this.path, `${separator}${lineOf(backup)}`);
      return removed;
    });
  }

  /** Removes every backup `due` says goes, and its row. Returns the paths removed. */
  async removeWhere(due: (backup: StepBackup) => boolean): Promise<string[]> {
    return this.mutex.run(async () => {
      const going = (await this.read()).filter(due);
      const removed = await this.removeAll(going);
      await this.keepAllBut(going);
      return removed;
    });
  }

  private async removeAll(backups: readonly StepBackup[]): Promise<string[]> {
    const removed: string[] = [];
    for (const { path } of backups) {
      if (await this.files.remove(path)) {
        removed.push(path);
      }
    }
    return removed;
  }

  /** Rewrites the ledger without `going`'s rows; a row whose file was already gone goes with them. */
  private async keepAllBut(going: readonly StepBackup[]): Promise<void> {
    if (going.length === 0) {
      return;
    }
    const gone = new Set(going.map(({ path }) => path));
    const kept = (await this.read()).filter(({ path }) => !gone.has(path));
    await this.files.write(this.path, kept.map(lineOf).join(''));
  }
}

function lineOf(backup: StepBackup): string {
  return toJsonlLine({ [VERSION_FIELD]: LEDGER_VERSION, step: backup.step, path: backup.path, at: backup.at });
}
