import { posix, win32 } from 'node:path';
/**
 * A path as the platform compares it: absolute against the folder, one slash, any case on Windows, where each
 * segment also drops the trailing dots and spaces Windows ignores (`config.json.` opens `config.json`).
 */
export function samePathKey(path, cwd, platform) {
    if (platform !== 'win32') {
        return posix.resolve(cwd, path);
    }
    const segments = win32.resolve(cwd, path).replaceAll('\\', '/').toLowerCase().split('/');
    return segments.map((segment, index) => (index === 0 ? segment : segment.replace(/[. ]+$/, ''))).join('/');
}
/** A path's last segment, past a leading drive (`C:config.json` names `config.json`). */
export function lastSegmentOf(path) {
    const undriven = path.replace(/^[a-z]:/i, '');
    return undriven.slice(Math.max(undriven.lastIndexOf('/'), undriven.lastIndexOf('\\')) + 1);
}
/** How a Windows path reaches a file past its plain spelling, or undefined for a plain one. */
export function aliasFormOf(path) {
    if (/^[\\/]{2}[?.][\\/]/.test(path)) {
        return 'a device path';
    }
    if (/^[\\/]{2}[^\\/]/.test(path)) {
        return 'a network share path';
    }
    return lastSegmentOf(path).includes(':') ? 'an alternate data stream' : undefined;
}
/** The file name Windows opens for a path: its last segment with a stream cut and trailing dots and spaces dropped. */
export function openedNameOf(path) {
    return (lastSegmentOf(path).split(':')[0] ?? '').replace(/[. ]+$/, '');
}
/**
 * A drive path's head as a Unix shell on Windows spells it: Git Bash's `/c/` and WSL's `/mnt/c/` (what a `wsl`
 * launch reads the Windows drive as), each the drive `c:/`, a bare head (`/c`, `/mnt/c`) its root.
 */
const UNIX_DRIVE = /^\/(?:mnt\/)?([a-z])(?:\/|$)/i;
/**
 * A path as the platform's own tools read it: on Windows a Unix shell's drive head is the drive. A `/mnt/c/` read
 * under Git Bash, where no such folder is made, only makes a guard refuse more, never less.
 */
export function nativePathOf(path, platform) {
    return platform === 'win32' ? path.replace(UNIX_DRIVE, '$1:/') : path;
}
