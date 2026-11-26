import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HostCommit, HostCommitFile } from '../issues/host.ts';
import { pullPathsOf } from './pull-paths.ts';

const WHICH = 'its head aaaaaaaaa over main';
const file = (path: string, previousPath: string | null = null): HostCommitFile => ({ path, previousPath, status: previousPath === null ? 'modified' : 'renamed', patch: '@@ -1 +1 @@\n+x', blob: 'b'.repeat(40) });
const commit = (sha: string, files: readonly HostCommitFile[], parents = 1): HostCommit => ({ sha, subject: 'docs: a', parents, files });

describe('pullPathsOf (T3448)', () => {
  it("lists every commit's paths once, in commit order, with the path a rename left", () => {
    const read = { kind: 'read', commits: [commit('1'.repeat(40), [file('docs/a.md'), file('docs/b.md')]), commit('2'.repeat(40), [file('docs/a.md'), file('docs/c.md', 'src/old.ts')])] } as const;
    assert.deepEqual(pullPathsOf(read, WHICH), { kind: 'paths', paths: ['docs/a.md', 'docs/b.md', 'src/old.ts', 'docs/c.md'] });
  });

  /** A read that must never clear: its name, the read, and the reason the refusal gives. */
  const refusals: readonly { readonly name: string; readonly read: Parameters<typeof pullPathsOf>[0]; readonly reason: RegExp }[] = [
    { name: 'no commits of the head', read: { kind: 'missing' }, reason: /the code host shows no commits of its head aaaaaaaaa over main/u },
    { name: 'a read the host cut short', read: { kind: 'partial', reason: 'the compare shows 250 of 260 commits' }, reason: /^the compare shows 250 of 260 commits: the answerer clears only a change whose every path it read$/u },
    { name: 'a head with no commit over the base', read: { kind: 'read', commits: [] }, reason: /carries no commit: there is no change to clear/u },
    { name: 'a merge commit', read: { kind: 'read', commits: [commit('3'.repeat(40), [file('docs/a.md')], 2)] }, reason: /333333333 "docs: a" of its head aaaaaaaaa over main is a merge commit/u },
    { name: 'a commit shown with no files', read: { kind: 'read', commits: [commit('1'.repeat(40), [file('docs/a.md')]), commit('4'.repeat(40), [])] }, reason: /shows 444444444 "docs: a" of its head aaaaaaaaa over main with no files/u },
  ];

  for (const refusal of refusals) {
    it(`refuses ${refusal.name}`, () => {
      const found = pullPathsOf(refusal.read, WHICH);
      assert.equal(found.kind, 'refused', JSON.stringify(found));
      assert.match(found.kind === 'refused' ? found.reason : '', refusal.reason);
    });
  }

  it('fails when the host could not be read', () => {
    assert.deepEqual(pullPathsOf({ kind: 'failed', reason: 'gh exited 1' }, WHICH), { kind: 'failed', reason: 'gh exited 1' });
  });
});
