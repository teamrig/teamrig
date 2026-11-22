import { createHash } from 'node:crypto';
import type { HostCommit, HostCommitFile } from '../issues/host.ts';
import type { WorkCommit } from './work-commits.ts';

/** A hunk header (`@@ -12,3 +12,4 @@ heading`): where the hunk sits and the base's nearby line, both moved by a rebase. */
const HUNK_HEADER = /^@@ .*$/gmu;

/**
 * One file's change as one record: what it is and how it changed, then its patch with every hunk header cut to `@@`,
 * so a rebase over other lines keeps it; with no patch, its content's id, which moves with any change. JSON, so no path
 * holding a space or a newline can read as another file list (T5130 M1).
 */
function fileRecord(file: HostCommitFile): string {
  const patch = file.patch === null ? null : file.patch.replace(HUNK_HEADER, '@@');
  return JSON.stringify([file.status, file.previousPath, file.path, patch, file.patch === null ? file.blob : null]);
}

const byPath = (a: HostCommitFile, b: HostCommitFile): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * A code host's commits as work commits, oldest first (T5117), or the first commit no comparison may rest on: one the
 * host shows with no files and one parent. Locally git proves such a commit a no-op; from a host an empty list proves
 * nothing, so it is never dropped unread (T5130 M2).
 */
export type HostWork =
  | { readonly kind: 'work'; readonly commits: readonly WorkCommit[] }
  | { readonly kind: 'empty'; readonly commit: HostCommit };

/** `commits` as work commits: a merge commit as one, every other with a patch id hashed from its files in path order. */
export function hostWorkCommits(commits: readonly HostCommit[]): HostWork {
  const work: WorkCommit[] = [];
  for (const commit of commits) {
    if (commit.parents > 1) {
      work.push({ sha: commit.sha, subject: commit.subject, merge: true, patch: '' });
      continue;
    }
    if (commit.files.length === 0) {
      return { kind: 'empty', commit };
    }
    const records = [...commit.files].sort(byPath).map(fileRecord);
    work.push({ sha: commit.sha, subject: commit.subject, merge: false, patch: createHash('sha256').update(records.join('\n')).digest('hex') });
  }
  return { kind: 'work', commits: work };
}
