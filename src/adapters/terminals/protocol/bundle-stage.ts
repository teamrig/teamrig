import { chmod, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { errorCode } from '../../../plugin-api/index.ts';
import type { CheckedBundle } from './bundle.ts';

const FOLDER_MODE = 0o700;
const FILE_MODE = 0o600;
const ENTRY_MODE = 0o700;

/** Where the stage keeps a staged bundle's manifest: beside its folder, which holds the listed files alone. */
export function keptManifestPath(dir: string, sha256: string): string {
  return join(dir, `${sha256}.json`);
}

function under(folder: string, path: string): string {
  return join(folder, ...path.split('/'));
}

/** POSIX modes; Windows reports only a read-only bit, and its privacy is the profile's access list. */
function hasMode(mode: number, expected: number): boolean {
  return process.platform === 'win32' || (mode & 0o777) === expected;
}

/** Each folder the listed paths sit in, by its path from the bundle's root. */
function foldersOf(paths: Iterable<string>): ReadonlySet<string> {
  const folders = new Set<string>();
  for (const path of paths) {
    for (let parent = path.lastIndexOf('/'); parent > 0; parent = path.lastIndexOf('/', parent - 1)) {
      folders.add(path.slice(0, parent));
    }
  }
  return folders;
}

/**
 * Whether `folder` holds exactly the bundle: every listed file with its bytes, and nothing the manifest does not list,
 * a link or an empty folder included, since a stray file changes no listed file's hash. Checked on every run, never
 * remembered. A missing folder holds none of it.
 */
async function holdsExactly(folder: string, bundle: CheckedBundle): Promise<boolean> {
  const folders = foldersOf(bundle.files.keys());
  let found = 0;
  const walk = async (relative: string): Promise<boolean> => {
    const at = relative === '' ? folder : under(folder, relative);
    const stats = await lstat(at);
    if (!stats.isDirectory() || !hasMode(stats.mode, FOLDER_MODE)) {
      return false;
    }
    for (const name of await readdir(at)) {
      const path = relative === '' ? name : `${relative}/${name}`;
      if (folders.has(path)) {
        if (!(await walk(path))) {
          return false;
        }
        continue;
      }
      const expected = bundle.files.get(path);
      const file = await lstat(under(folder, path));
      if (expected === undefined || !file.isFile() || file.size !== expected.byteLength || !hasMode(file.mode, path === bundle.manifest.entry ? ENTRY_MODE : FILE_MODE)) {
        return false;
      }
      if (!(await readFile(under(folder, path))).equals(expected)) {
        return false;
      }
      found += 1;
    }
    return true;
  };
  try {
    return (await walk('')) && found === bundle.files.size;
  } catch (error) {
    const code = errorCode(error);
    // Moved or replaced while it was read.
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return false;
    }
    throw error;
  }
}

/** Makes `folder` with mode `FOLDER_MODE` whatever the umask is. */
async function privateFolder(folder: string): Promise<void> {
  await mkdir(folder, { recursive: true, mode: FOLDER_MODE });
  await chmod(folder, FOLDER_MODE);
}

async function writeBundle(folder: string, bundle: CheckedBundle): Promise<void> {
  await privateFolder(folder);
  for (const inner of [...foldersOf(bundle.files.keys())].sort()) {
    await privateFolder(under(folder, inner));
  }
  for (const [path, bytes] of bundle.files) {
    await writeFile(under(folder, path), bytes, { mode: path === bundle.manifest.entry ? ENTRY_MODE : FILE_MODE, flag: 'wx' });
  }
}

/** Moves `from` out of the way to `to`; false when it was not there. */
async function movedAside(from: string, to: string): Promise<boolean> {
  try {
    await rename(from, to);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/** How often one stage tries to put its copy in place while other processes put theirs. */
const PLACE_TRIES = 8;

/**
 * Puts the copy at `temporary` at `folder`, unless a whole copy is there: that one stays, as a run may be starting it.
 * The rename is tried before anything is moved, so a copy is moved aside only after it was seen not to hold the bundle.
 * Another process may put a whole one there in between: a run starting from that one fails, and this puts its own back.
 */
async function putInPlace(temporary: string, folder: string, bundle: CheckedBundle): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(temporary, folder);
      return;
    } catch (error) {
      if (await holdsExactly(folder, bundle)) {
        return;
      }
      if (attempt === PLACE_TRIES) {
        throw error;
      }
    }
    const aside = `${temporary}.${attempt}.old`;
    if (await movedAside(folder, aside)) {
      await rm(aside, { recursive: true, force: true });
    }
  }
}

/** True when `path` is a file holding exactly `bytes`. */
async function holdsBytes(path: string, bytes: Uint8Array): Promise<boolean> {
  try {
    return (await readFile(path)).equals(bytes);
  } catch {
    return false;
  }
}

/**
 * Moves the written manifest `temporary` onto its kept name. Windows refuses a rename onto a file another stage is
 * renaming at the same moment (EPERM), so a refused rename is done when the kept file already holds the same bytes,
 * as it is named by their sha, and is tried again a moment later otherwise.
 */
export async function keepManifest(temporary: string, kept: string, bytes: Uint8Array): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(temporary, kept);
      return;
    } catch (error) {
      if (await holdsBytes(kept, bytes)) {
        return;
      }
      if (attempt === PLACE_TRIES) {
        throw error;
      }
    }
    await sleep(attempt * 5);
  }
}

let stagings = 0;

/**
 * The real `BundlePorts.stage`: each pinned bundle's copy lives in `<dir>/<manifest sha256>/`, folders and files open
 * to this user only. A copy is given again only when it holds exactly the checked bytes and nothing else; anything off
 * means a fresh copy of the bytes in memory, moved into place by a rename of the whole folder, so no run starts a
 * half-written one. When another process puts its own copy there first, that copy is checked the same way and used.
 * `suffix` names this process's temporary folders.
 */
export function bundleStage(dir: string, suffix: string): (bundle: CheckedBundle) => Promise<string> {
  return async (bundle) => {
    const folder = join(dir, bundle.sha256);
    if (await holdsExactly(folder, bundle)) {
      return folder;
    }
    stagings += 1;
    const temporary = join(dir, `.${bundle.sha256}.${suffix}.${stagings}.tmp`);
    await privateFolder(dirname(temporary));
    try {
      const kept = `${temporary}.json`;
      await writeFile(kept, bundle.manifestBytes, { mode: FILE_MODE });
      await keepManifest(kept, keptManifestPath(dir, bundle.sha256), bundle.manifestBytes);
      await writeBundle(temporary, bundle);
      await putInPlace(temporary, folder, bundle);
      return folder;
    } finally {
      await rm(temporary, { recursive: true, force: true });
      await rm(`${temporary}.json`, { force: true });
    }
  };
}
