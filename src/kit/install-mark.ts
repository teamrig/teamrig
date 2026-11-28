import { chmod, lstat, readdir } from 'node:fs/promises';
import { join, win32 } from 'node:path';
import type { Mutex } from '../core/lock.ts';
import { powerShellRequest } from '../core/powershell.ts';
import type { ProgramRunner } from '../core/program-runner.ts';
import { kitCurrentPath, kitCurrentRecordPath, kitVersionsFolder } from './kit-versions.ts';

/**
 * The read-only mark on teamrig's install in the kit home (design #2617, step A): what `versions/` holds refuses a
 * write, a new file and a removal by the person's own account, and so do the contents of the records naming the
 * version in use, so only teamrig's own writers change them, each lifting the mark under the kit install lock and
 * setting it again after. The kit home itself still grants delete-child, so `versions/` can still be renamed or
 * replaced and `current` or `current.json` deleted or replaced; the integrity check (design #2617, step C) is to find those.
 * It hardens the install against a stray edit; it is no boundary against a process that lifts it as teamrig does.
 */

/** A path the mark covers: one file, or a folder with all it holds (`tree`). */
export interface MarkedPath {
  readonly path: string;
  readonly tree: boolean;
}

/** Sets and lifts the mark. A missing path is skipped, so a fresh or uninstalled kit home needs no special case. */
export interface InstallMark {
  lift(paths: readonly MarkedPath[]): Promise<void>;
  set(paths: readonly MarkedPath[]): Promise<void>;
}

/**
 * What the mark covers: `versions/` with every kept version, `current` and `current.json`. The launcher
 * `bin/teamrig.mjs` is left out until its writers run under the install lock (T5842).
 */
export function kitMarkedPaths(kitHome: string): readonly MarkedPath[] {
  return [
    { path: kitVersionsFolder(kitHome), tree: true },
    { path: kitCurrentPath(kitHome), tree: false },
    { path: kitCurrentRecordPath(kitHome), tree: false },
  ];
}

/**
 * The install lock with the mark lifted while its holder runs and set again after, also when the task throws or the
 * lift fails partway. A set that fails goes to `report`, not thrown: the change it guarded did happen, and the next
 * locked change sets the mark again. A lock another process holds lifts nothing.
 */
export function markedMutex(lock: Mutex, mark: InstallMark, paths: readonly MarkedPath[], report: (error: unknown) => Promise<void> | void): Mutex {
  return {
    run: <T>(task: () => Promise<T>): Promise<T> =>
      lock.run(async () => {
        try {
          await mark.lift(paths);
          return await task();
        } finally {
          await mark.set(paths).catch(report);
        }
      }),
  };
}

/** A mark that does nothing: a platform with no mark of its own. */
export const NO_INSTALL_MARK: InstallMark = {
  lift: async () => undefined,
  set: async () => undefined,
};

/** Whether something is at `path`, a link counted without following it. */
async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/** Every file and folder in the tree at `path`, itself first; links are left out, never followed. */
async function treeEntries(path: string, tree: boolean): Promise<readonly string[]> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) {
    return [];
  }
  if (!tree || !stats.isDirectory()) {
    return [path];
  }
  const inside = await readdir(path);
  const nested = await Promise.all(inside.map((name) => treeEntries(join(path, name), true)));
  return [path, ...nested.flat()];
}

const WRITE_BITS = 0o222;
const OWNER_WRITE = 0o200;

/** POSIX: the write bits off every file and folder for set, the owner's write bit back for lift. */
export function posixInstallMark(): InstallMark {
  const each = async (paths: readonly MarkedPath[], modeOf: (mode: number) => number): Promise<void> => {
    for (const marked of paths) {
      if (!(await present(marked.path))) {
        continue;
      }
      for (const entry of await treeEntries(marked.path, marked.tree)) {
        const { mode } = await lstat(entry);
        await chmod(entry, modeOf(mode & 0o7777));
      }
    }
  };
  return {
    lift: (paths) => each(paths, (mode) => mode | OWNER_WRITE),
    set: (paths) => each(paths, (mode) => mode & ~WRITE_BITS),
  };
}

/**
 * The rights a Windows mark denies: writing, appending, writing attributes and removing; on a folder also removing what
 * it holds, inherited by everything inside. Written through .NET, which keeps SYNCHRONIZE out of a deny entry: icacls
 * adds it to any entry denying removal, and a denied SYNCHRONIZE refuses every open, reads too.
 */
const FILE_DENY = 'WriteData,AppendData,WriteExtendedAttributes,WriteAttributes,Delete';
const TREE_DENY = `${FILE_DENY},DeleteSubdirectoriesAndFiles`;

/**
 * The PowerShell script that lifts (`set` false) or sets the mark on the paths, given as base64 UTF-8 JSON so no path
 * needs quoting. Each path gets the one deny entry the mark means (its rights and inheritance) for the account running
 * it: a set adds it, a lift takes away only those rights, so a deny entry the person wrote themselves stays. .NET merges
 * an added entry into one with the same account, type and inheritance, so a lift subtracts the rights
 * (`RemoveAccessRule`) rather than matching a whole entry (`RemoveAccessRuleSpecific` would miss a merged one and leave
 * the mark on); a right the person denied too in such an entry goes with it. Only the access list is written, never the
 * owner. A missing path is skipped.
 */
export function windowsMarkScript(paths: readonly MarkedPath[], set: boolean): string {
  const payload = Buffer.from(JSON.stringify(paths), 'utf8').toString('base64');
  return [
    "$ErrorActionPreference = 'Stop'",
    "$marked = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + payload + "')) | ConvertFrom-Json",
    '$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User',
    'foreach ($m in $marked) {',
    '  if (-not (Test-Path -LiteralPath $m.path)) { continue }',
    '  $item = Get-Item -LiteralPath $m.path -Force',
    `  $rights = if ($m.tree) { '${TREE_DENY}' } else { '${FILE_DENY}' }`,
    "  $inherit = if ($m.tree -and $item.PSIsContainer) { 'ContainerInherit,ObjectInherit' } else { 'None' }",
    "  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, $rights, $inherit, 'None', 'Deny')",
    "  $acl = $item.GetAccessControl('Access')",
    set ? '  $acl.AddAccessRule($rule)' : '  [void]$acl.RemoveAccessRule($rule)',
    '  $item.SetAccessControl($acl)',
    '}',
  ].join('\n');
}

export interface WindowsMarkPorts {
  readonly run: ProgramRunner;
  readonly systemRoot: string;
}

/**
 * Windows: a deny entry for the person's own account in each path's access list. The owner keeps the right to change
 * the list, so lifting always works; a folder's entry is inherited, so one entry covers every kept version and the
 * files a locked install copied in. Windows PowerShell runs from its absolute path, never a name PATH resolves.
 */
export function windowsInstallMark(ports: WindowsMarkPorts): InstallMark {
  const program = win32.join(ports.systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const ran = async (paths: readonly MarkedPath[], set: boolean): Promise<void> => {
    const result = await ports.run({ program, args: powerShellRequest(windowsMarkScript(paths, set)).args });
    if (result.end.kind !== 'exited' || result.end.code !== 0) {
      throw new Error(`the install mark could not be ${set ? 'set' : 'lifted'}: ${result.stderr.trim() || result.stdout.trim() || 'no output'}`);
    }
  };
  return {
    lift: (paths) => ran(paths, false),
    set: (paths) => ran(paths, true),
  };
}

/** How long one Windows PowerShell run that lifts or sets the mark may take: its start alone is about half a second. */
export const INSTALL_MARK_TIMEOUT_MS = 60_000;

/** The mark of this platform: Windows access lists, else POSIX modes. */
export function nodeInstallMark(platform: NodeJS.Platform, run: ProgramRunner, systemRoot: string | undefined): InstallMark {
  return platform === 'win32' ? windowsInstallMark({ run, systemRoot: systemRoot ?? 'C:\\Windows' }) : posixInstallMark();
}
