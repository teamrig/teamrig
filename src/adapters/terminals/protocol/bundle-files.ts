import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { errorCode } from '../../../plugin-api/index.ts';
import type { FileReading, ReadBundleFile } from './bundle.ts';

/** Read-only, refusing a link at the path itself and never waiting on a pipe, where the system has those flags. */
const OPEN_PLAIN: number = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

function refused(why: string): FileReading {
  return { kind: 'refused', why };
}

/** The first part of `path` under `root` that is a link, each folder on the way and the file. */
async function linkOnTheWay(root: string, parts: readonly string[]): Promise<boolean> {
  let at = root;
  for (const part of parts) {
    at = join(at, part);
    if ((await lstat(at)).isSymbolicLink()) {
      return true;
    }
  }
  return false;
}

/**
 * The real `ReadBundleFile`: a regular file, read once through one handle, no more than `cap` bytes of it however it
 * grows meanwhile. A link anywhere below `root` is refused, so a listed path is the file it names.
 */
export const readBundleFile: ReadBundleFile = async (root, path, cap) => {
  const parts = path.split('/');
  try {
    if (await linkOnTheWay(root, parts)) {
      return refused('is reached by a link');
    }
    const handle = await open(join(root, ...parts), OPEN_PLAIN);
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) {
        return refused('is not a regular file');
      }
      if (stats.size > cap) {
        return refused(`is over the ${cap} bytes left for it`);
      }
      // One byte past the size the handle gave: a file that grew since is refused, never read past its cap.
      const buffer = Buffer.alloc(stats.size + 1);
      let length = 0;
      while (length < buffer.byteLength) {
        const { bytesRead } = await handle.read(buffer, length, buffer.byteLength - length, length);
        if (bytesRead === 0) {
          break;
        }
        length += bytesRead;
      }
      return length > stats.size ? refused('changed while teamrig read it') : { kind: 'bytes', bytes: new Uint8Array(buffer.subarray(0, length)) };
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { kind: 'missing' };
    }
    throw error;
  }
};
