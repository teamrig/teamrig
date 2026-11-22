import { createHash } from 'node:crypto';
import type { HostCommit, HostCommitFile } from '../issues/host.ts';
import type { WorkCommit } from './work-commits.ts';

/** A hunk header (`@@ -12,3 +12,4 @@ heading`): where the hunk sits and the base's nearby line, both moved by a rebase. */
const HUNK_HEADER = /^@@ .*$/u;

/**
 * The lines one file's change hashes as: what it is and how it changed, then its patch with every hunk header cut to
 * `@@`, so a rebase over other lines keeps them; with no patch, its content's id, which moves with any change.
 */
function fileLines(file: HostCommitFile): string[] {
  const head = `file ${file.status} ${file.previousPath ?? ''} ${file.path}`;
  return file.patch === null ? [head, `blob ${file.blob}`] : [head, ...file.patch.split('\n').map((line) => line.replace(HUNK_HEADER, '@@'))];
}

const byPath = (a: HostCommitFile, b: HostCommitFile): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * A code host's commits as work commits, oldest first (T5117): a merge commit as one, a commit that changes no file
 * dropped (as workCommitsOf drops one), every other with a patch id hashed from its files' patches in path order.
 */
export function hostWorkCommits(commits: readonly HostCommit[]): WorkCommit[] {
  return commits.flatMap((commit): WorkCommit[] => {
    if (commit.parents > 1) return [{ sha: commit.sha, subject: commit.subject, merge: true, patch: '' }];
    if (commit.files.length === 0) return [];
    const lines = [...commit.files].sort(byPath).flatMap(fileLines);
    return [{ sha: commit.sha, subject: commit.subject, merge: false, patch: createHash('sha256').update(lines.join('\n')).digest('hex') }];
  });
}
