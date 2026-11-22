import { posix, win32 } from 'node:path';
import type { Env } from './home.ts';
import type { PathProbe } from './path-probe.ts';

/** What a PATH search reads: the variables, the operating system, and whether a file is there. */
export interface PathSearchDeps {
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  readonly probe: PathProbe;
}

/** The extensions Node.js appends to a bare program name on Windows, in order: `.com`, then `.exe`. */
export const WINDOWS_PROGRAM_EXTENSIONS: readonly string[] = ['.com', '.exe'];

/** The extensions a command typed in cmd or PowerShell may have on Windows, a `.cmd` shim among them (`teamrig.cmd`). */
export const WINDOWS_COMMAND_EXTENSIONS: readonly string[] = ['.com', '.exe', '.cmd', '.bat'];

/** The name a variable has in `env`, given in upper case; Windows names ignore case (`Path` for `PATH`). Undefined when it is not set. */
export function envKey(env: Env, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') {
    return Object.hasOwn(env, name) ? name : undefined;
  }
  return Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
}

/** A variable by name; Windows names ignore case (`Path`, `PATH`). */
export function envVariable(env: Env, name: string, platform: NodeJS.Platform): string | undefined {
  const key = envKey(env, name, platform);
  return key === undefined ? undefined : env[key];
}

/** A PATH-like list split on `delimiter`, each part trimmed and unquoted, empty parts left out. */
export function pathList(value: string | undefined, delimiter: string): string[] {
  return (value ?? '').split(delimiter).flatMap((part) => {
    const trimmed = part.trim().replace(/^"(.*)"$/, '$1');
    return trimmed === '' ? [] : [trimmed];
  });
}

/**
 * The file Node.js starts for `execFile(name)`, found as it searches PATH: on Windows `<name>.com`, then
 * `<name>.exe`, in each folder (or `windowsExtensions` in that order, as `WINDOWS_COMMAND_EXTENSIONS` for what a shell
 * runs); elsewhere `<name>` in each folder. It only looks, starting nothing; undefined when no folder has it.
 */
export async function findProgram(name: string, deps: PathSearchDeps, windowsExtensions: readonly string[] = WINDOWS_PROGRAM_EXTENSIONS): Promise<string | undefined> {
  const windows = deps.platform === 'win32';
  const folders = pathList(envVariable(deps.env, 'PATH', deps.platform), windows ? ';' : ':');
  const candidates = folders.flatMap((folder) =>
    windows ? windowsExtensions.map((extension) => win32.join(folder, `${name}${extension}`)) : [posix.join(folder, name)],
  );
  for (const path of candidates) {
    if ((await deps.probe.kind(path)) === 'file') {
      return path;
    }
  }
  return undefined;
}
