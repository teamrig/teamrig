import { readFileSync, statSync } from 'node:fs';
import type { ScriptTexts } from './script-reads.ts';

/**
 * The largest script the secret guard reads, in bytes. A script a session writes stays far smaller; reading a bigger
 * file would cost the hook's time on every run of it, so one over the cap holds no finding.
 */
export const SCRIPT_TEXT_CAP_BYTES = 1024 * 1024;

/**
 * Reads script files from this host's disk, synchronously as the secret guard runs: only a regular file at or under
 * `capBytes`, so a device, a pipe or a folder is never opened.
 */
export function diskScriptTexts(capBytes: number = SCRIPT_TEXT_CAP_BYTES): ScriptTexts {
  return {
    text(path: string): string | undefined {
      try {
        const stats = statSync(path);
        return stats.isFile() && stats.size <= capBytes ? readFileSync(path, 'utf8') : undefined;
      } catch {
        return undefined;
      }
    },
  };
}
