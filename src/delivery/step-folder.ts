import { posix, win32 } from 'node:path';

/**
 * A folder move at the start of a shell line, where the rest runs only once the move worked (`&&`): cmd.exe's
 * `cd /d <dir>`, `chdir`, `pushd`, or a POSIX shell's `cd <dir>`. A folder the shell would expand (`%VAR%`, `$HOME`,
 * `~`, a glob) or an option (`cd -`) matches none, so the line keeps the folder it was started in.
 */
interface FolderMove {
  /** The folder as written, its quotes taken off. */
  readonly dir: string;
  /** cmd.exe's `cd` without `/d`, which moves within the current drive only. */
  readonly sameDrive: boolean;
  /** What runs after the `&&`. */
  readonly rest: string;
}

/** cmd.exe: `cd`, `chdir` (each with an optional `/d`) or `pushd`, then a folder, quoted or up to the `&&`. */
const CMD_MOVE = /^\s*(cd|chdir|pushd)(\s+\/d)?\s+(?:"([^"%!^]+)"|([^"%!^&|<>()]+?))\s*&&(.*)$/is;

/** A POSIX shell: `cd`, then one folder word, quoted or plain, with nothing the shell would expand. */
const SH_MOVE = /^\s*cd\s+(?:'([^']+)'|"([^"$`\\!]+)"|([^\s'"$`\\;&|<>()*?~{}[\]!#-][^\s'"$`\\;&|<>()*?{}[\]!#]*))\s*&&(.*)$/s;

function moveOf(line: string, platform: NodeJS.Platform): FolderMove | undefined {
  if (platform === 'win32') {
    const match = CMD_MOVE.exec(line);
    const [, verb = '', drive, quoted, plain, rest = ''] = match ?? [];
    const dir = quoted ?? plain?.trim();
    if (match === null || dir === undefined || (drive !== undefined && verb.toLowerCase() === 'pushd')) {
      return undefined;
    }
    return { dir, sameDrive: drive === undefined && verb.toLowerCase() !== 'pushd', rest };
  }
  const match = SH_MOVE.exec(line);
  const [, single, double, plain, rest = ''] = match ?? [];
  const dir = single ?? double ?? plain;
  return match === null || dir === undefined ? undefined : { dir, sameDrive: false, rest };
}

/** A Windows path's drive letter, upper-cased; undefined for a UNC path or one with no drive. */
function driveOf(path: string): string | undefined {
  return /^([A-Za-z]):/.exec(path)?.[1]?.toUpperCase();
}

/**
 * The folder a queued or tested step's command really runs in (T5550): `cwd`, or, for a one-word shell line, the
 * folder its leading moves (`cd /d <worktree> && npm run check`) end in, so the log header and the ledger name the
 * tree the step tested, not the one it was queued from. A step queued from a main checkout that moves into a
 * worktree inside its line is the common case. Several words run as one program, which moves nothing; on Windows
 * a `cd` without `/d` to another drive leaves the current folder as it was.
 */
export function stepFolderOf(words: readonly string[], cwd: string, platform: NodeJS.Platform): string {
  const [line] = words;
  if (words.length !== 1 || line === undefined) {
    return cwd;
  }
  const paths = platform === 'win32' ? win32 : posix;
  let folder = cwd;
  let rest = line;
  for (let move = moveOf(rest, platform); move !== undefined; move = moveOf(rest, platform)) {
    const target = paths.resolve(folder, move.dir);
    if (!move.sameDrive || driveOf(target) === driveOf(folder)) {
      folder = target;
    }
    rest = move.rest;
  }
  return folder;
}
