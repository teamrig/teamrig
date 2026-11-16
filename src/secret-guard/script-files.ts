import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import type { ScriptTexts } from './script-reads.ts';

/**
 * The largest script the secret guard reads, in bytes. A script a session writes stays far smaller; reading a bigger
 * file would cost the hook's time on every run of it, so one over the cap holds no finding.
 */
export const SCRIPT_TEXT_CAP_BYTES = 1024 * 1024;

/** What the reader learns of an open file. */
export interface OpenFileStats {
  isFile(): boolean;
  readonly size: number;
}

/** The file calls the reader makes, each on the descriptor it opened, so a spec can follow them. */
export interface ScriptFileCalls {
  open(path: string, flags: number): number;
  stat(fd: number): OpenFileStats;
  read(fd: number): string;
  close(fd: number): void;
}

const NODE_FILE_CALLS: ScriptFileCalls = {
  open: (path, flags) => openSync(path, flags),
  stat: (fd) => fstatSync(fd),
  read: (fd) => readFileSync(fd, 'utf8'),
  close: (fd) => closeSync(fd),
};

/**
 * Read only and, off Windows, without waiting: opening a pipe for reading otherwise waits for a writer, which would
 * hold the hook. Windows has no such flag; a path there is a drive path (`onLocalDrive`), never a named pipe.
 */
export const SCRIPT_OPEN_FLAGS = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK);

/**
 * Reads script files from this host's disk, synchronously as the secret guard runs: only a regular file at or under
 * `capBytes`. It opens the path once and checks what it opened, so a file swapped for a pipe or a device between a
 * check and the read is never read.
 */
export function diskScriptTexts(capBytes: number = SCRIPT_TEXT_CAP_BYTES, calls: ScriptFileCalls = NODE_FILE_CALLS): ScriptTexts {
  return {
    text(path: string): string | undefined {
      let fd: number;
      try {
        fd = calls.open(path, SCRIPT_OPEN_FLAGS);
      } catch {
        return undefined;
      }
      try {
        const stats = calls.stat(fd);
        return stats.isFile() && stats.size <= capBytes ? calls.read(fd) : undefined;
      } catch {
        return undefined;
      } finally {
        calls.close(fd);
      }
    },
  };
}
