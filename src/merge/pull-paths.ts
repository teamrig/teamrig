import type { HostPullWork } from '../issues/host.ts';

/**
 * The paths a pull request's head changes over its base, as the code host shows its commits (T3448): every file's path
 * and the path it was renamed from, each once in commit order; refused, naming why, when the read cannot show them
 * all; failed, when the host could not be read.
 */
export type PullPaths =
  | { readonly kind: 'paths'; readonly paths: readonly string[] }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * The paths `read` (the commits of `which`, a head over a base) changes, failing closed: no commits, a commit the host
 * shows with no files, a merge commit (whose files the host shows against one parent only, so a path changed on its
 * other side would go unseen) or a read the host cut short are refused, as the answerer clears a change only by every
 * path it touches.
 */
export function pullPathsOf(read: HostPullWork, which: string): PullPaths {
  switch (read.kind) {
    case 'missing':
      return { kind: 'refused', reason: `the code host shows no commits of ${which}: the answerer clears only a change whose paths it can read` };
    case 'partial':
      return { kind: 'refused', reason: `${read.reason}: the answerer clears only a change whose every path it read` };
    case 'failed':
      return { kind: 'failed', reason: read.reason };
    case 'read':
      break;
  }
  if (read.commits.length === 0) {
    return { kind: 'refused', reason: `${which} carries no commit: there is no change to clear` };
  }
  const paths = new Set<string>();
  for (const commit of read.commits) {
    const named = `${commit.sha.slice(0, 9)} "${commit.subject}" of ${which}`;
    if (commit.parents > 1) {
      return { kind: 'refused', reason: `${named} is a merge commit, whose files the code host shows against one parent only: rebase it away` };
    }
    if (commit.files.length === 0) {
      return { kind: 'refused', reason: `the code host shows ${named} with no files: the answerer clears only commits read whole, so rebase the empty commit away` };
    }
    for (const file of commit.files) {
      if (file.previousPath !== null) {
        paths.add(file.previousPath);
      }
      paths.add(file.path);
    }
  }
  return { kind: 'paths', paths: [...paths] };
}
