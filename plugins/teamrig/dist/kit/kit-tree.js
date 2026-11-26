import { cp, lstat, realpath, rm } from 'node:fs/promises';
/** The real file system. Windows refuses to remove a file another process holds open, so a removal is tried a few times. */
export function nodeKitTree() {
    return {
        async copyFolder(from, to) {
            // cp's filter sees the root too, so a linked root would copy nothing: resolve it first.
            await cp(await realpath(from), to, {
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
