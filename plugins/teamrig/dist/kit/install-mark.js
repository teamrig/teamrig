import { chmod, lstat, readdir } from 'node:fs/promises';
import { join, win32 } from 'node:path';
import { powerShellRequest } from "../core/powershell.js";
import { kitCurrentPath, kitCurrentRecordPath, kitVersionsFolder } from "./kit-versions.js";
/**
 * What the mark covers: `versions/` with every kept version, `current` and `current.json`. The launcher
 * `bin/teamrig.mjs` is left out until its writers run under the install lock (T5842).
 */
export function kitMarkedPaths(kitHome) {
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
export function markedMutex(lock, mark, paths, report) {
    return {
        run: (task) => lock.run(async () => {
            try {
                await mark.lift(paths);
                return await task();
            }
            finally {
                await mark.set(paths).catch(report);
            }
        }),
    };
}
/** A mark that does nothing: a platform with no mark of its own. */
export const NO_INSTALL_MARK = {
    lift: async () => undefined,
    set: async () => undefined,
};
/** Whether something is at `path`, a link counted without following it. */
async function present(path) {
    try {
        await lstat(path);
        return true;
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}
/** Every file and folder in the tree at `path`, itself first; links are left out, never followed. */
async function treeEntries(path, tree) {
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
export function posixInstallMark() {
    const each = async (paths, modeOf) => {
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
export function windowsMarkScript(paths, set) {
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
/**
 * Windows: a deny entry for the person's own account in each path's access list. The owner keeps the right to change
 * the list, so lifting always works; a folder's entry is inherited, so one entry covers every kept version and the
 * files a locked install copied in. Windows PowerShell runs from its absolute path, never a name PATH resolves.
 */
export function windowsInstallMark(ports) {
    const program = win32.join(ports.systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const ran = async (paths, set) => {
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
export function nodeInstallMark(platform, run, systemRoot) {
    return platform === 'win32' ? windowsInstallMark({ run, systemRoot: systemRoot ?? 'C:\\Windows' }) : posixInstallMark();
}
