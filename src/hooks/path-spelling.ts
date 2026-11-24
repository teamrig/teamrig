import { posix, win32 } from 'node:path';

/**
 * How the guards that keep a file from a session's writes tell that two spellings reach one file: the platform's own
 * compare form, and the Windows spellings that reach a file past its plain path. Shared by the config guard
 * (service-role-guard.ts) and the install guard (install-guard.ts).
 */

/** A Windows spelling that reaches a file past its plain path, which neither the text nor its real path ties to one file. */
export type AliasForm = 'a device path' | 'a network share path' | 'an alternate data stream';

/**
 * A path as the platform compares it: absolute against the folder, one slash, any case on Windows, where each
 * segment also drops the trailing dots and spaces Windows ignores (`config.json.` opens `config.json`).
 */
export function samePathKey(path: string, cwd: string, platform: NodeJS.Platform): string {
  if (platform !== 'win32') {
    return posix.resolve(cwd, path);
  }
  const segments = win32.resolve(cwd, path).replaceAll('\\', '/').toLowerCase().split('/');
  return segments.map((segment, index) => (index === 0 ? segment : segment.replace(/[. ]+$/, ''))).join('/');
}

/** A path's last segment, past a leading drive (`C:config.json` names `config.json`). */
export function lastSegmentOf(path: string): string {
  const undriven = path.replace(/^[a-z]:/i, '');
  return undriven.slice(Math.max(undriven.lastIndexOf('/'), undriven.lastIndexOf('\\')) + 1);
}

/** How a Windows path reaches a file past its plain spelling, or undefined for a plain one. */
export function aliasFormOf(path: string): AliasForm | undefined {
  if (/^[\\/]{2}[?.][\\/]/.test(path)) {
    return 'a device path';
  }
  if (/^[\\/]{2}[^\\/]/.test(path)) {
    return 'a network share path';
  }
  return lastSegmentOf(path).includes(':') ? 'an alternate data stream' : undefined;
}

/** The file name Windows opens for a path: its last segment with a stream cut and trailing dots and spaces dropped. */
export function openedNameOf(path: string): string {
  return (lastSegmentOf(path).split(':')[0] ?? '').replace(/[. ]+$/, '');
}

/** A Git Bash drive path's head, `/c/`, which Windows tools read as the drive `c:/`. */
const MSYS_DRIVE = /^\/([a-z])(?=\/)/i;

/** A path as the platform's own tools read it: on Windows a Git Bash `/c/` drive is the drive `c:/`. */
export function nativePathOf(path: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? path.replace(MSYS_DRIVE, '$1:') : path;
}
