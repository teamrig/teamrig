import { cp, lstat, rm } from 'node:fs/promises';

/**
 * The folder copies teamrig's own install takes (kit-versions.ts): a release's files copied byte for byte into the kit
 * home, and a kept version removed with all it holds. `Files` reads and writes text, so it has no copy that keeps a
 * binary file whole.
 */
export interface KitTree {
  /**
   * Copies the folder `from`, with all it holds, to `to`, byte for byte. A link or junction in it is left out, never
   * followed, so the copy holds only what is inside `from`. Throws when something is at `to` already.
   */
  copyFolder(from: string, to: string): Promise<void>;
  /** Removes the folder and all it holds; nothing when it is missing. Throws when a file in it cannot be removed. */
  removeFolder(path: string): Promise<void>;
}

/** The real file system. Windows refuses to remove a file another process holds open, so a removal is tried a few times. */
export function nodeKitTree(): KitTree {
  return {
    async copyFolder(from, to) {
      await cp(from, to, {
        recursive: true,
        errorOnExist: true,
        force: false,
        filter: async (source) => !(await lstat(source)).isSymbolicLink(),
      });
    },
    async removeFolder(path) {
      await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}
