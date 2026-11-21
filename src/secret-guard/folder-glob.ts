import { posix, win32 } from 'node:path';

/**
 * `folder`, an absolute path on `platform`, as a glob of the secret guard that fits that folder: forward slashes, `.`
 * and `..` resolved, no slash at its end, and each wildcard character of its name made a one-character set, which
 * fits that character alone. A Windows path rooted with no drive is on the drive the session works on, which is not
 * known here, so its glob fits the folder on any drive; one on a network share names its place whole.
 */
export function folderGlob(folder: string, platform: NodeJS.Platform): string {
  const slashed = folder.replaceAll('\\', '/');
  const literal = posix
    .normalize(slashed)
    .replace(/\/+$/, '')
    .replace(/[*?[]/g, (char) => `[${char}]`);
  const onSomeDrive = platform === 'win32' && !/^[A-Za-z]:/.test(literal) && !slashed.startsWith('//');
  return onSomeDrive ? `?:${literal}` : literal;
}

/**
 * The globs of the files `names` in `folder`, a host's own folder an environment variable moved: the guard keeps them
 * there as it does at the folder's default place. None when `folder` is unset or blank, or no absolute path on
 * `platform`: the folder such a value names hangs on where the session started, which is not known here.
 */
export function movedFolderSecrets(folder: string | undefined, names: readonly string[], platform: NodeJS.Platform): readonly string[] {
  const value = folder?.trim();
  if (!value || !(platform === 'win32' ? win32 : posix).isAbsolute(value)) {
    return [];
  }
  const glob = folderGlob(value, platform);
  return names.map((name) => `${glob}/${name}`);
}
