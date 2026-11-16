/**
 * True when `path` is on one of this host's drives: `C:\` or `C:/`, or on a host other than Windows a root `/`. A
 * guard runs before the line it reads is let run, so it opens no other path (`//host/share`, `\\host\share`,
 * `\\?\UNC\host`, a device), nor runs a program in one: that would connect to a host the line's text chose, as the
 * user (T3038, T3339).
 */
export function onLocalDrive(path: string, platform: typeof process.platform = process.platform): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || (platform !== 'win32' && /^\/(?!\/)/.test(path));
}
