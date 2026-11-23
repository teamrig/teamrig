import { posix, win32 } from 'node:path';
import type { PathSearchDeps } from './path-search.ts';
import { envVariable, pathList } from './path-search.ts';

/** What finding the store's writer reads: PATH and SystemRoot, the operating system, the files, and the current folder. */
export interface StoreProgramDeps extends PathSearchDeps {
  readonly cwd: string;
}

/** The store's writer as an absolute path, or why teamrig will not run it. */
export type StoreProgram = { readonly kind: 'found'; readonly path: string } | { readonly kind: 'refused'; readonly reason: string };

/** The tool each store saves and removes a secret with: the one that asks for the key, so it is never run by bare name. */
export const STORE_WRITERS = { win32: 'cmdkey.exe', darwin: 'security', linux: 'secret-tool' } as const;

/** macOS ships `security` here, in the sealed system volume. */
const MACOS_SECURITY = '/usr/bin/security';

/**
 * The absolute path of the program that saves and removes the store's secrets. Started by a bare name, Windows looks
 * in the current folder before PATH, so a `cmdkey.exe` planted in a repo would ask for the key in its place: Windows
 * takes `%SystemRoot%\System32\cmdkey.exe`, macOS `/usr/bin/security`, and Linux `secret-tool` from PATH's absolute
 * folders only. A path inside the current folder, or the repo or worktree holding it, is refused.
 */
export async function storeWriter(deps: StoreProgramDeps): Promise<StoreProgram> {
  const found = await candidate(deps);
  if (found.kind === 'refused') return found;
  const path = deps.platform === 'win32' ? win32 : posix;
  for (const folder of [deps.cwd, await workTreeOf(deps)]) {
    if (folder !== undefined && inside(path, folder, found.path, deps.platform === 'win32')) {
      return { kind: 'refused', reason: `${found.path} is inside ${folder}, where a session could have put it; teamrig runs the store's tool only from outside it` };
    }
  }
  return found;
}

async function candidate(deps: StoreProgramDeps): Promise<StoreProgram> {
  switch (deps.platform) {
    case 'win32': {
      const root = envVariable(deps.env, 'SYSTEMROOT', 'win32');
      if (root === undefined || !win32.isAbsolute(root)) return { kind: 'refused', reason: 'SystemRoot is not an absolute folder, so cmdkey.exe cannot be found in System32' };
      return isFile(deps, win32.join(root, 'System32', STORE_WRITERS.win32));
    }
    case 'darwin':
      return isFile(deps, MACOS_SECURITY);
    default: {
      const folders = pathList(envVariable(deps.env, 'PATH', deps.platform), ':').filter((folder) => posix.isAbsolute(folder));
      for (const folder of folders) {
        const found = await isFile(deps, posix.join(folder, STORE_WRITERS.linux));
        if (found.kind === 'found') return found;
      }
      return { kind: 'refused', reason: `${STORE_WRITERS.linux} is in none of PATH's absolute folders: install libsecret's tools` };
    }
  }
}

async function isFile(deps: StoreProgramDeps, path: string): Promise<StoreProgram> {
  return (await deps.probe.kind(path)) === 'file' ? { kind: 'found', path } : { kind: 'refused', reason: `${path} is not there` };
}

/** The nearest folder at or above the current one holding a `.git` file or folder: the repo or worktree, if any. */
async function workTreeOf(deps: StoreProgramDeps): Promise<string | undefined> {
  const path = deps.platform === 'win32' ? win32 : posix;
  let folder = path.resolve(deps.cwd);
  for (;;) {
    if ((await deps.probe.kind(path.join(folder, '.git'))) !== 'none') return folder;
    const parent = path.dirname(folder);
    if (parent === folder) return undefined;
    folder = parent;
  }
}

function inside(path: typeof win32 | typeof posix, folder: string, file: string, ignoreCase: boolean): boolean {
  const [from, to] = ignoreCase ? [folder.toLowerCase(), file.toLowerCase()] : [folder, file];
  const relative = path.relative(from, to);
  return relative !== '' && relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative);
}
