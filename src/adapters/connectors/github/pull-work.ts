import { isRecord, type HostCommit, type HostCommitFile } from '../../../plugin-api/index.ts';

/**
 * The most files GitHub lists for one commit read with no paging; a commit at the cap may hold more, so it reads as
 * partial (T5117).
 */
export const COMMIT_FILES_MAX = 300;

/**
 * The most commits a compare lists, and the most a landing reads one by one; a head carrying more reads as partial.
 * GitHub's compare lists up to 250; 100 keeps one landing's reads bounded.
 */
export const COMPARE_COMMITS_MAX = 100;

/** A compare as gh.ts pullCompareArgs reads it: the commits' shas oldest first, and how many the head carries in all. */
export interface CompareRead {
  readonly shas: readonly string[];
  readonly total: number;
}

function parsed(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

/** The compare an answer of GitHub's compare read holds; undefined when it is off that shape. */
export function compareIn(stdout: string): CompareRead | undefined {
  const answer = parsed(stdout);
  const commits = isRecord(answer) ? answer['commits'] : undefined;
  const total = isRecord(answer) ? answer['total_commits'] : undefined;
  if (!Array.isArray(commits) || typeof total !== 'number') {
    return undefined;
  }
  const shas = commits.map((commit: unknown) => (isRecord(commit) ? commit['sha'] : undefined));
  return shas.every((sha): sha is string => typeof sha === 'string') ? { shas, total } : undefined;
}

function fileOf(item: unknown): HostCommitFile | undefined {
  if (!isRecord(item)) {
    return undefined;
  }
  const { filename, previous_filename: previous, status, patch, sha } = item;
  if (typeof filename !== 'string' || typeof status !== 'string' || typeof sha !== 'string' || (previous !== undefined && typeof previous !== 'string') || (patch !== undefined && typeof patch !== 'string')) {
    return undefined;
  }
  return { path: filename, previousPath: previous ?? null, status, patch: patch ?? null, blob: sha };
}

/**
 * The commit an answer of GitHub's commit read holds: its sha, its message's first line, its parents and each file's
 * change (GitHub leaves `patch` out for a binary file or one too large to show). Undefined when it is off that shape.
 */
export function commitIn(stdout: string): HostCommit | undefined {
  const answer = parsed(stdout);
  if (!isRecord(answer)) {
    return undefined;
  }
  const { sha, commit, parents, files } = answer;
  const message = isRecord(commit) ? commit['message'] : undefined;
  if (typeof sha !== 'string' || typeof message !== 'string' || !Array.isArray(parents) || !Array.isArray(files)) {
    return undefined;
  }
  const read = files.map(fileOf);
  if (!read.every((file): file is HostCommitFile => file !== undefined)) {
    return undefined;
  }
  return { sha, subject: message.split('\n')[0] ?? '', parents: parents.length, files: read };
}
