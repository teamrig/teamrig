import { watch } from 'node:fs';
import { dirname } from 'node:path';
import { errorCode } from "./guards.js";
/** Why a watch of a folder failed because the folder, or a folder on its path, is not there. */
const MISSING = new Set(['ENOENT', 'ENOTDIR']);
/**
 * Folder signals over a system's folder watches, one level each. A folder that is not there is watched through the
 * nearest folder above it that is, and taken over once a change there shows it made.
 */
export function folderSignalsOver(watchFolder) {
    return {
        watch(folders, onChange) {
            const watches = [...new Set(folders)].map((folder) => new OneFolder(folder, watchFolder, onChange));
            return {
                unwatched: () => watches.filter((each) => each.refused).map((each) => each.folder),
                close: () => {
                    for (const each of watches) {
                        each.close();
                    }
                },
            };
        },
    };
}
/**
 * The system's folder watches (`fs.watch`, on every OS Node.js runs on). No watch holds the process open: the
 * reader's own wait does.
 */
export const nodeFolderSignals = folderSignalsOver((folder, onEvent) => watch(folder, { persistent: false }, onEvent));
/** The watch of one folder, or of the nearest folder above it while it is not there. */
class OneFolder {
    folder;
    refused = false;
    watchFolder;
    onChange;
    watcher;
    watchedAt;
    closed = false;
    constructor(folder, watchFolder, onChange) {
        this.folder = folder;
        this.watchFolder = watchFolder;
        this.onChange = onChange;
        this.attach();
    }
    close() {
        this.closed = true;
        this.watcher?.close();
        this.watcher = undefined;
    }
    attach() {
        let at = this.folder;
        for (;;) {
            try {
                this.watcher = this.watchFolder(at, () => this.changed());
                this.watchedAt = at;
                this.watcher.on('error', () => this.fail());
                return;
            }
            catch (error) {
                const above = dirname(at);
                if (!MISSING.has(errorCode(error) ?? '') || above === at) {
                    this.refused = true;
                    return;
                }
                at = above;
            }
        }
    }
    changed() {
        if (this.closed) {
            return;
        }
        if (this.watchedAt !== this.folder) {
            // A change above the folder may be the folder made: watch it again, from the folder itself down.
            this.watcher?.close();
            this.attach();
        }
        this.onChange();
    }
    fail() {
        if (this.closed) {
            return;
        }
        this.watcher?.close();
        this.watcher = undefined;
        this.refused = true;
        this.onChange();
    }
}
