import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Of } from './spawn.ts';

const PRIVATE = 0o700;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

async function bytesAt(path: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * The real `PinnedRunPorts.stage`: each pinned version's copy lives in `<dir>/<sha256>/<name>`, folder and file open
 * to this user only (POSIX modes; on Windows the folder sits in the user's own profile, whose access list does that).
 * A copy is given again only when its bytes still hash to the pin; else it is written anew, by a rename of a whole
 * file, so no run starts a half-written one. `suffix` names this process's temporary file.
 */
export function privateStage(dir: string, suffix: string): (bytes: Uint8Array, sha256: string, name: string) => Promise<string> {
  return async (bytes, sha256, name) => {
    const folder = join(dir, sha256);
    const target = join(folder, name);
    const existing = await bytesAt(target);
    if (existing !== undefined && sha256Of(existing) === sha256) {
      return target;
    }
    await mkdir(folder, { recursive: true, mode: PRIVATE });
    await chmod(folder, PRIVATE);
    const temporary = `${target}.${suffix}.tmp`;
    try {
      await writeFile(temporary, bytes, { mode: PRIVATE, flag: 'w' });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
    return target;
  };
}
