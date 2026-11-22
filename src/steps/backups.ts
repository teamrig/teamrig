import { basename, dirname } from 'node:path';
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

/** Where steps put their backups, and the file names each step gives them. */
export interface StepBackupPlace {
  readonly folder: string;
  isBackupFile(step: string, name: string): boolean;
}

/**
 * What a removal did: the backups it removed, and the rows it would not act on because their path is not a step's
 * backup (outside the backups folder, through a link, not a plain file, or another name). Both lose their rows.
 */
export interface StepBackupRemoval {
  readonly removed: readonly string[];
  readonly refused: readonly string[];
}

const LEDGER_VERSION = 1;

/**
 * The ledger of the backups steps took. A backup is temporary: it goes once the same step's next run succeeds, or
 * once it is past its age. Only a path written here is ever removed, and only when it is a plain file directly in the
 * backups folder with its step's backup name: the ledger is a plain file anyone on the machine can write, so a row is
 * never trusted to name what teamrig may remove.
 */
export class StepBackupLedger {
  private readonly files: Files;
  private readonly path: string;
  private readonly mutex: Mutex;
  private readonly place: StepBackupPlace;

  constructor(files: Files, path: string, mutex: Mutex, place: StepBackupPlace) {
    this.files = files;
    this.path = path;
    this.mutex = mutex;
    this.place = place;
  }

  /** Every backup on record, oldest first; a damaged line is skipped. */
  async read(): Promise<StepBackup[]> {
    const { records } = parseJsonl((await this.files.read(this.path)) ?? '');
    return records.flatMap(({ record }) => {
      const [step, path, at] = [stringField(record, 'step'), stringField(record, 'path'), stringField(record, 'at')];
      return step === undefined || path === undefined || at === undefined ? [] : [{ step, path, at }];
    });
  }

  /** Records `backup` as its step's newest and removes the step's earlier backups, which the run that took it made stale. */
  async replace(backup: StepBackup): Promise<StepBackupRemoval> {
    return this.mutex.run(async () => {
      const earlier = (await this.read()).filter((row) => row.step === backup.step && row.path !== backup.path);
      const removal = await this.removeAll(earlier);
      await this.keepAllBut(earlier);
      const current = (await this.files.read(this.path)) ?? '';
      const separator = current === '' || current.endsWith('\n') ? '' : '\n';
      await this.files.append(this.path, `${separator}${lineOf(backup)}`);
      return removal;
    });
  }

  /** Removes every backup `due` says goes, and its row. */
  async removeWhere(due: (backup: StepBackup) => boolean): Promise<StepBackupRemoval> {
    return this.mutex.run(async () => {
      const going = (await this.read()).filter(due);
      const removal = await this.removeAll(going);
      await this.keepAllBut(going);
      return removal;
    });
  }

  /** Removes each row's backup that `isOwnBackup` allows; a row whose path holds nothing any more is neither. */
  private async removeAll(backups: readonly StepBackup[]): Promise<StepBackupRemoval> {
    const folder = await this.files.realPath(this.place.folder);
    const removed: string[] = [];
    const refused: string[] = [];
    for (const backup of backups) {
      if ((await this.files.realPath(backup.path)) === undefined) {
        continue;
      }
      if (folder === undefined || !(await this.isOwnBackup(backup, folder))) {
        refused.push(backup.path);
      } else if (await this.files.remove(backup.path)) {
        removed.push(backup.path);
      }
    }
    return { removed, refused };
  }

  /** Whether the row names a plain file, not a link, directly in the backups folder `folder`, with its step's backup name. */
  private async isOwnBackup({ step, path }: StepBackup, folder: string): Promise<boolean> {
    return (
      this.place.isBackupFile(step, basename(path)) &&
      (await this.files.realPath(dirname(path))) === folder &&
      (await this.files.isPlainFile(path))
    );
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
