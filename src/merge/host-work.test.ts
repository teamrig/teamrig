import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HostCommit, HostCommitFile } from '../issues/host.ts';
import { hostWorkCommits } from './host-work.ts';
import { workChanges, type WorkCommit } from './work-commits.ts';

const file = (path: string, patch: string | null, more: Partial<HostCommitFile> = {}): HostCommitFile => ({ path, previousPath: null, status: 'modified', patch, blob: 'b1', ...more });
const commit = (sha: string, files: readonly HostCommitFile[], parents = 1, subject = 'core: a'): HostCommit => ({ sha, subject, parents, files });
const workOf = (commits: readonly HostCommit[]): readonly WorkCommit[] => {
  const work = hostWorkCommits(commits);
  assert.equal(work.kind, 'work');
  return work.kind === 'work' ? work.commits : [];
};
const patchOf = (one: HostCommit): string => workOf([one])[0]?.patch ?? '';

describe('hostWorkCommits: a code host read of commits as work commits (T5117)', () => {
  it('keeps the patch id when only the hunk positions and headings move, as a rebase moves them', () => {
    const before = commit('a1', [file('src/a.ts', '@@ -10,3 +10,4 @@ function one()\n x\n+y\n z')]);
    const after = commit('a2', [file('src/a.ts', '@@ -40,3 +40,4 @@ function two()\n x\n+y\n z')]);
    assert.equal(patchOf(before), patchOf(after));
    assert.deepEqual(workChanges(workOf([before]), workOf([after])), []);
  });

  it('moves the patch id for a changed line, another path, a rename or another status', () => {
    const base = commit('a1', [file('src/a.ts', '@@ -1 +1 @@\n-x\n+y')]);
    assert.notEqual(patchOf(base), patchOf(commit('a2', [file('src/a.ts', '@@ -1 +1 @@\n-x\n+z')])));
    assert.notEqual(patchOf(base), patchOf(commit('a2', [file('src/b.ts', '@@ -1 +1 @@\n-x\n+y')])));
    assert.notEqual(patchOf(base), patchOf(commit('a2', [file('src/a.ts', '@@ -1 +1 @@\n-x\n+y', { previousPath: 'src/old.ts', status: 'renamed' })])));
    assert.notEqual(patchOf(base), patchOf(commit('a2', [file('src/a.ts', '@@ -1 +1 @@\n-x\n+y', { status: 'added' })])));
  });

  it('reads a file with no patch by its content id, and the files in path order', () => {
    assert.notEqual(patchOf(commit('a1', [file('logo.png', null, { blob: 'b1' })])), patchOf(commit('a2', [file('logo.png', null, { blob: 'b2' })])));
    const one = file('a.ts', '@@ -1 +1 @@\n+a');
    const two = file('b.ts', '@@ -1 +1 @@\n+b');
    assert.equal(patchOf(commit('a1', [one, two])), patchOf(commit('a2', [two, one])));
  });

  it('keeps a merge commit as one, with no patch', () => {
    assert.deepEqual(workOf([commit('m1', [], 2, 'merge main')]), [{ sha: 'm1', subject: 'merge main', merge: true, patch: '' }]);
  });

  it('names a one-parent commit the host shows with no files, never dropping it unread (T5130 M2)', () => {
    const empty = commit('e1', []);
    assert.deepEqual(hostWorkCommits([commit('a1', [file('a.ts', '@@ -1 +1 @@\n+a')]), empty]), { kind: 'empty', commit: empty });
  });

  it('hashes each file as one record, so paths with spaces or newlines never read as another file list (T5130 M1)', () => {
    const renamed = (previousPath: string, path: string): HostCommit => commit('r1', [file(path, '@@ -1 +1 @@\n+x', { previousPath, status: 'renamed' })]);
    assert.notEqual(patchOf(renamed('a', 'b c')), patchOf(renamed('a b', 'c')));
    const two = commit('n1', [file('a.ts', '@@ -1 +1 @@\n+x'), file('b.ts', '@@ -1 +1 @@\n+y')]);
    const smuggled = commit('n2', [file('a.ts', `@@ -1 +1 @@\n+x\nfile modified  b.ts\n@@ -1 +1 @@\n+y`)]);
    assert.notEqual(patchOf(two), patchOf(smuggled));
    const newlinePath = commit('n3', [file('a.ts\n+x', null)]);
    assert.notEqual(patchOf(newlinePath), patchOf(commit('n4', [file('a.ts', '+x')])));
  });
});
