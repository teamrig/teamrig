import { posix } from 'node:path';
import { normalisePath } from './memory-files.ts';

/** The read side of `MemoryFiles` a snapshot needs. */
interface StoredFiles {
  paths(): string[];
  get(path: string): string | undefined;
}

/** The act log's own files in a team's state folder (src/acts/act-log.ts): the log and the lock its writers take. */
const ACT_LOG_NAMES: ReadonlySet<string> = new Set(['acts.jsonl', 'acts.lock']);

/** Whether `path` is a team's act log or its lock, which every write command adds to, refusals too (T4813). */
export function isActLogPath(path: string): boolean {
  const normal = normalisePath(path);
  return ACT_LOG_NAMES.has(posix.basename(normal)) && posix.basename(posix.dirname(normal)) === 'state';
}

/**
 * Every file with its text but the act log, for a spec that a refused or no-op write changed none of the team's
 * data: the act log keeps that run as an act, by design.
 */
export function teamDataOf(files: StoredFiles): [string, string | undefined][] {
  return files
    .paths()
    .filter((path) => !isActLogPath(path))
    .map((path) => [path, files.get(path)]);
}
