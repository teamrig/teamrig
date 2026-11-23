import { basename, dirname } from 'node:path';
import { stringField } from "../core/guards.js";
import { parseJsonl, toJsonlLine, VERSION_FIELD } from "../core/jsonl.js";
const LEDGER_VERSION = 1;
/**
 * The ledger of the backups steps took. A backup is temporary: it goes once the same step's next run succeeds, or
 * once it is past its age. Only a path written here is ever removed, and only when it is a plain file directly in the
 * backups folder with its step's backup name: the ledger is a plain file anyone on the machine can write, so a row is
 * never trusted to name what teamrig may remove.
 */
export class StepBackupLedger {
    files;
    path;
    mutex;
    place;
    constructor(files, path, mutex, place) {
        this.files = files;
        this.path = path;
        this.mutex = mutex;
        this.place = place;
    }
    /** Every backup on record, oldest first; a damaged line is skipped. */
    async read() {
        const { records } = parseJsonl((await this.files.read(this.path)) ?? '');
        return records.flatMap(({ record }) => {
            const [step, path, at] = [stringField(record, 'step'), stringField(record, 'path'), stringField(record, 'at')];
            return step === undefined || path === undefined || at === undefined ? [] : [{ step, path, at }];
        });
    }
    /** Records `backup` as its step's newest and removes the step's earlier backups, which the run that took it made stale. */
    async replace(backup) {
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
    async removeWhere(due) {
        return this.mutex.run(async () => {
            const going = (await this.read()).filter(due);
            const removal = await this.removeAll(going);
            await this.keepAllBut(going);
            return removal;
        });
    }
    /** Removes each row's backup that `isOwnBackup` allows; a row whose path holds nothing any more is neither. */
    async removeAll(backups) {
        const folder = await this.files.realPath(this.place.folder);
        const removed = [];
        const refused = [];
        for (const backup of backups) {
            if ((await this.files.realPath(backup.path)) === undefined) {
                continue;
            }
            if (folder === undefined || !(await this.isOwnBackup(backup, folder))) {
                refused.push(backup.path);
            }
            else if (await this.files.remove(backup.path)) {
                removed.push(backup.path);
            }
        }
        return { removed, refused };
    }
    /** Whether the row names a plain file, not a link, directly in the backups folder `folder`, with its step's backup name. */
    async isOwnBackup({ step, path }, folder) {
        return (this.place.isBackupFile(step, basename(path)) &&
            (await this.files.realPath(dirname(path))) === folder &&
            (await this.files.isPlainFile(path)));
    }
    /** Rewrites the ledger without `going`'s rows; a row whose file was already gone goes with them. */
    async keepAllBut(going) {
        if (going.length === 0) {
            return;
        }
        const gone = new Set(going.map(({ path }) => path));
        const kept = (await this.read()).filter(({ path }) => !gone.has(path));
        await this.files.write(this.path, kept.map(lineOf).join(''));
    }
}
function lineOf(backup) {
    return toJsonlLine({ [VERSION_FIELD]: LEDGER_VERSION, step: backup.step, path: backup.path, at: backup.at });
}
