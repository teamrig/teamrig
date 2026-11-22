import { posix, win32 } from 'node:path';
import type { Files } from '../core/files.ts';
import type { Env } from '../core/home.ts';
import { findProgram, type PathSearchDeps } from '../core/path-search.ts';

/**
 * What the gh child of `teamrig gh` runs with (T4961): an environment built from an allow-list, never the session's
 * own, and gh and git by an absolute path found outside the checkout. gh reads programs to start from its environment
 * (browser, editor, pager) and its settings, aliases and logins from its config folder, and it runs with the owner's
 * key in `GH_TOKEN`, so neither may come from the session.
 */

/**
 * The variables gh gets from its caller: where programs, the home and temp folders are, the locale, the proxy, and
 * `GH_REPO`, which places the run's repository as teamrig placed its owner. Names compare without case. No certificate
 * variable (`SSL_CERT_FILE`, `SSL_CERT_DIR`) passes: gh's TLS trusts the system's roots alone.
 */
export const GH_PASSED_VARIABLES: readonly string[] = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'LANG',
  'LC_ALL',
  'TZ',
  'NO_COLOR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'GH_REPO',
];

/** The variables naming a program gh may start; each gets the inert command. */
const LAUNCHER_VARIABLES = ['GH_BROWSER', 'BROWSER', 'GH_EDITOR', 'EDITOR', 'VISUAL'] as const;

/** What the built environment points gh at. */
export interface GhChildSetup {
  /** gh's config folder, teamrig's own (`ghConfigDirOf`). */
  readonly configDir: string;
  /** A command that starts nothing and fails, standing in for a browser or an editor (`inertCommandOf`). */
  readonly inert: string;
}

/**
 * The environment of the gh child: `env`'s GH_PASSED_VARIABLES alone, then gh's config folder set to teamrig's own,
 * every browser and editor variable set to the inert command, the pager to `cat` (which gh skips), and prompts and the
 * update check off. A key is added by the caller (`GH_TOKEN`).
 */
export function ghChildEnvOf(env: Env, setup: GhChildSetup): Env {
  const passed = new Set(GH_PASSED_VARIABLES);
  const kept = Object.entries(env).filter(([name, value]) => value !== undefined && passed.has(name.toUpperCase()));
  const launchers = Object.fromEntries(LAUNCHER_VARIABLES.map((name) => [name, setup.inert]));
  return {
    ...Object.fromEntries(kept),
    ...launchers,
    GH_CONFIG_DIR: setup.configDir,
    GH_PAGER: 'cat',
    PAGER: 'cat',
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
  };
}

/**
 * The inert command: this Node.js program told to exit 1 at once. gh splits the command as a shell would, so the path
 * is quoted and written with forward slashes, which a backslash escape cannot change.
 */
export function inertCommandOf(node: string): string {
  return `"${node.replaceAll('\\', '/')}" --eval=process.exit(1)`;
}

/** gh's config folder: `gh-config` in the kit home, a folder teamrig makes and gh never holds a login in. */
export function ghConfigDirOf(kitHome: string, platform: NodeJS.Platform): string {
  return (platform === 'win32' ? win32 : posix).join(kitHome, 'gh-config');
}

/** A config.yml line gh writes itself: its format's version. Blank and comment lines pass too. */
const HARMLESS_CONFIG_LINE = /^\s*(?:#.*|version:\s*["']?\d+["']?\s*)?$/u;

/**
 * Why gh must not run with `dir` as its config folder, or undefined when it may: the folder is made when missing, and
 * refused when it holds a login (`hosts.yml`) or any setting but the format's version in `config.yml`, as gh reads its
 * aliases, browser, editor, pager and HTTP socket there.
 */
export async function configDirRefusal(dir: string, files: Pick<Files, 'read' | 'makeFolder'>, platform: NodeJS.Platform): Promise<string | undefined> {
  const paths = platform === 'win32' ? win32 : posix;
  await files.makeFolder(dir);
  const hosts = paths.join(dir, 'hosts.yml');
  if ((await files.read(hosts)) !== undefined) {
    return `gh's config folder holds a login, ${hosts}; teamrig gh runs gh on the owner's saved key alone: remove the file`;
  }
  const config = paths.join(dir, 'config.yml');
  const settings = await files.read(config);
  if (settings !== undefined && !settings.split(/\r?\n/u).every((line) => HARMLESS_CONFIG_LINE.test(line))) {
    return `gh's config folder holds settings, ${config}, which can set an alias, a browser, an editor, a pager or an HTTP socket gh would run with the key: remove the file`;
  }
  return undefined;
}

/** A program found for a run, by its absolute path, or why it is not used. */
export type FoundProgram = { readonly kind: 'found'; readonly path: string } | { readonly kind: 'refused'; readonly why: string };

/** Whether `path` is `folder` or below it; Windows paths ignore case and slash direction. */
function isInside(path: string, folder: string, platform: NodeJS.Platform): boolean {
  const paths = platform === 'win32' ? win32 : posix;
  const relative = paths.relative(paths.resolve(folder), paths.resolve(path));
  return relative === '' || (!relative.startsWith('..') && !paths.isAbsolute(relative));
}

/** The top folder of the checkout `cwd` is in: the nearest folder holding `.git` (a folder, or a worktree's file); undefined outside one. */
async function checkoutTopOf(cwd: string, search: PathSearchDeps): Promise<string | undefined> {
  const paths = search.platform === 'win32' ? win32 : posix;
  let folder = paths.resolve(cwd);
  for (;;) {
    if ((await search.probe.kind(paths.join(folder, '.git'))) !== 'none') {
      return folder;
    }
    const parent = paths.dirname(folder);
    if (parent === folder) {
      return undefined;
    }
    folder = parent;
  }
}

/**
 * `name` found on the caller's PATH by an absolute path, as the program teamrig starts in its place: a bare name would
 * be looked up in the current folder first on Windows. Refused when PATH lacks it, finds it by a relative folder, or
 * finds it in `cwd` or the checkout `cwd` is in, where a repository's own file would run instead of the installed one.
 */
export async function programOutsideCheckout(name: string, cwd: string, search: PathSearchDeps): Promise<FoundProgram> {
  const path = await findProgram(name, search);
  const paths = search.platform === 'win32' ? win32 : posix;
  if (path === undefined) {
    return { kind: 'refused', why: `${name} is not on PATH` };
  }
  if (!paths.isAbsolute(path)) {
    return { kind: 'refused', why: `PATH finds ${name} as ${path}, by a relative folder; give PATH absolute folders` };
  }
  const top = await checkoutTopOf(cwd, search);
  const inside = [cwd, ...(top === undefined ? [] : [top])].find((folder) => isInside(path, folder, search.platform));
  return inside === undefined ? { kind: 'found', path } : { kind: 'refused', why: `PATH finds ${name} as ${path}, inside ${inside}, so a file of the repository would run in place of the installed ${name}` };
}
