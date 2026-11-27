import { watch, type FSWatcher } from 'node:fs';
import { dirname } from 'node:path';
import { errorCode } from './guards.ts';

/** One watch of a set of folders, open until `close`. */
export interface FolderWatch {
  /**
   * The folders of the set no change of which can be told: the system refused the watch, or it ended with an error.
   * A folder that is not there yet is no such folder: its nearest folder that is there is watched in its place.
   */
  unwatched(): readonly string[];
  close(): void;
}

/** Tells when anything in a folder changes, so a reader of its files looks again only then. */
export interface FolderSignals {
  /** Watches each of `folders` (not the folders under it) and calls `onChange` after any change in one. */
  watch(folders: readonly string[], onChange: () => void): FolderWatch;
}

/** Why a watch of a folder failed because the folder, or a folder on its path, is not there. */
const MISSING = new Set(['ENOENT', 'ENOTDIR']);

/** The system's watch of one folder, as {@link folderSignalsOver} uses it. */
export interface SystemWatcher {
  on(event: 'error', listener: (error: Error) => void): unknown;
  close(): void;
}

/** Starts the system's watch of one folder, calling `onEvent` at each change in it; throws when it cannot. */
export type WatchFolder = (folder: string, onEvent: () => void) => SystemWatcher;

/**
 * Folder signals over a system's folder watches, one level each. A folder that is not there is watched through the
 * nearest folder above it that is, and taken over once a change there shows it made.
 */
export function folderSignalsOver(watchFolder: WatchFolder): FolderSignals {
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
export const nodeFolderSignals: FolderSignals = folderSignalsOver(
  (folder, onEvent) => watch(folder, { persistent: false }, onEvent),
);

/** The watch of one folder, or of the nearest folder above it while it is not there. */
class OneFolder {
  readonly folder: string;
  refused = false;
  private readonly watchFolder: WatchFolder;
  private readonly onChange: () => void;
  private watcher: SystemWatcher | undefined;
  private watchedAt: string | undefined;
  private closed = false;

  constructor(folder: string, watchFolder: WatchFolder, onChange: () => void) {
    this.folder = folder;
    this.watchFolder = watchFolder;
    this.onChange = onChange;
    this.attach();
  }

  close(): void {
    this.closed = true;
    this.watcher?.close();
    this.watcher = undefined;
  }

  private attach(): void {
    let at = this.folder;
    for (;;) {
      try {
        this.watcher = this.watchFolder(at, () => this.changed());
        this.watchedAt = at;
        this.watcher.on('error', () => this.fail());
        return;
      } catch (error) {
        const above = dirname(at);
        if (!MISSING.has(errorCode(error) ?? '') || above === at) {
          this.refused = true;
          return;
        }
        at = above;
      }
    }
  }

  private changed(): void {
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

  private fail(): void {
    if (this.closed) {
      return;
    }
    this.watcher?.close();
    this.watcher = undefined;
    this.refused = true;
    this.onChange();
  }
}
