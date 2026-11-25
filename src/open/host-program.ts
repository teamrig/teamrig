import { posix, win32 } from 'node:path';
import type { Files } from '../core/files.ts';
import type { Env } from '../core/home.ts';
import type { PathProbe } from '../core/path-probe.ts';
import { envVariable, pathList, programFolders } from '../core/path-search.ts';

/** How to start a host's program: `command`, then `prefix`, then the program's own arguments. */
export interface HostProgram {
  readonly command: string;
  readonly prefix: readonly string[];
}

export type ProgramSearch =
  | { readonly kind: 'found'; readonly program: HostProgram }
  /** `skipped`: launchers of that name that were found but cannot be started safely, and why. */
  | { readonly kind: 'missing'; readonly skipped: readonly string[] };

export interface ProgramSearchDeps {
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  readonly probe: PathProbe;
  readonly files: Files;
  /** The Node.js program that runs an npm-installed program's script. */
  readonly node: string;
}

const WINDOWS_EXTENSIONS = '.COM;.EXE;.BAT;.CMD';
const SCRIPT = /\.[cm]?js$/i;
/** npm's cmd-shim ends by running `"%dp0%\<target>" %*`: the target, beside the shim. */
const SHIM_TARGET = /"%~?dp0%?\\([^"\r\n]+)"\s+%\*/g;
/** A program's file name: no folder in it, so the search never leaves the folders PATH names. */
const FILE_NAME = /^[^\\/:]+$/;

/**
 * The program an npm `.cmd` shim runs. Node.js starts a `.cmd` only through cmd.exe, which would
 * read the prompt as cmd syntax, so the shim's own target is started instead: a script with Node.js,
 * or a program directly.
 */
async function shimProgram(deps: ProgramSearchDeps, shim: string): Promise<HostProgram | string> {
  const text = await deps.files.read(shim);
  const target = [...(text ?? '').matchAll(SHIM_TARGET)].at(-1)?.[1];
  if (target === undefined) {
    return `${shim} is not an npm launcher`;
  }
  const path = win32.join(win32.dirname(shim), target);
  if ((await deps.probe.kind(path)) !== 'file') {
    return `${shim} starts ${path}, which is not there`;
  }
  if (SCRIPT.test(path)) {
    return { command: deps.node, prefix: [path] };
  }
  return /\.exe$/i.test(path) ? { command: path, prefix: [] } : `${shim} starts ${path}, which is neither a script nor a program`;
}

async function windowsSearch(deps: ProgramSearchDeps, name: string): Promise<ProgramSearch> {
  const extensions = pathList(envVariable(deps.env, 'PATHEXT', 'win32') ?? WINDOWS_EXTENSIONS, ';').map((extension) => extension.toLowerCase());
  const skipped: string[] = [];
  for (const folder of programFolders(deps.env, 'win32')) {
    for (const extension of extensions) {
      const path = win32.join(folder, `${name}${extension}`);
      if ((await deps.probe.kind(path)) !== 'file') {
        continue;
      }
      if (extension === '.exe' || extension === '.com') {
        return { kind: 'found', program: { command: path, prefix: [] } };
      }
      if (extension === '.cmd' || extension === '.bat') {
        const program = await shimProgram(deps, path);
        if (typeof program !== 'string') {
          return { kind: 'found', program };
        }
        skipped.push(program);
      }
    }
  }
  return { kind: 'missing', skipped };
}

async function posixSearch(deps: ProgramSearchDeps, name: string): Promise<ProgramSearch> {
  for (const folder of programFolders(deps.env, deps.platform)) {
    const path = posix.join(folder, name);
    if ((await deps.probe.kind(path)) === 'file') {
      return { kind: 'found', program: { command: path, prefix: [] } };
    }
  }
  return { kind: 'missing', skipped: [] };
}

/**
 * The program a host names (`SessionLauncher.program`) on PATH, the way a shell finds it: a native `<name>.exe`, an
 * npm shim, or `<name>`. The name is a host adapter's word, so one that is no plain file name is found nowhere.
 */
export function findProgram(deps: ProgramSearchDeps, name: string): Promise<ProgramSearch> {
  if (!FILE_NAME.test(name)) {
    return Promise.resolve({ kind: 'missing', skipped: [`"${name}" is not a program's file name`] });
  }
  return deps.platform === 'win32' ? windowsSearch(deps, name) : posixSearch(deps, name);
}
