import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HostCommit, HostPullWork, PullStand } from '../issues/host.ts';
import { FakeIssueHost } from '../testing/fake-issue-host.ts';
import { pullCarry } from './pull-carry.ts';

const TARGET = { repo: 'acme/web', number: 12 };
const APPROVED = 'a'.repeat(40);
const LIVE = 'c'.repeat(40);
const PULL: PullStand = { id: 'PR_1', state: 'open', draft: false, head: LIVE, base: 'main', defaultBranch: 'main', mergeQueue: false, queued: false, conflicts: false, checks: 'passing' };

/** A one-file commit whose patch adds `line` at hunk position `at`, as a rebase moves it. */
function commit(sha: string, subject: string, line: string, at = 1, parents = 1): HostCommit {
  return { sha, subject, parents, files: [{ path: 'src/a.ts', previousPath: null, status: 'modified', patch: `@@ -${String(at)},2 +${String(at)},3 @@ f()\n x\n+${line}\n y`, blob: sha }] };
}

const read = (...commits: HostCommit[]): HostPullWork => ({ kind: 'read', commits });
const ONE = commit('1'.repeat(40), 'feat: one', 'one');
const TWO = commit('2'.repeat(40), 'fix: two', 'two');
/** ONE and TWO rebased onto a newer base: new shas, their hunks further down. */
const ONE_REBASED = commit('3'.repeat(40), 'feat: one', 'one', 40);
const TWO_REBASED = commit('4'.repeat(40), 'fix: two', 'two', 41);

/** A host carrying `approved` at APPROVED and `live` at LIVE, each over main. */
function hostWith(approved: HostPullWork, live: HostPullWork): FakeIssueHost {
  return new FakeIssueHost().carries(TARGET, 'main', APPROVED, approved).carries(TARGET, 'main', LIVE, live);
}

describe('pullCarry (T5117)', () => {
  it('carries an approval to the same work commits rebased onto a newer base, counting them', async () => {
    assert.deepEqual(await pullCarry(hostWith(read(ONE, TWO), read(ONE_REBASED, TWO_REBASED)), TARGET, PULL, APPROVED), { kind: 'carried', commits: 2 });
  });

  /** A refusal case: the live head's work and the words the reason must hold. */
  const refusals: readonly { readonly name: string; readonly live: HostPullWork; readonly reason: RegExp }[] = [
    { name: 'a commit changed', live: read(ONE_REBASED, commit('5'.repeat(40), 'fix: two', 'other')), reason: /changed 222222222 "fix: two", now 555555555/u },
    { name: 'a commit added', live: read(ONE_REBASED, TWO_REBASED, commit('6'.repeat(40), 'feat: more', 'more')), reason: /added 666666666 "feat: more"/u },
    { name: 'a commit dropped', live: read(ONE_REBASED), reason: /dropped 222222222 "fix: two"/u },
    { name: 'the commits reordered', live: read(TWO_REBASED, ONE_REBASED), reason: /reordered, now 444444444, 333333333/u },
    { name: 'a merge commit came in', live: read(ONE_REBASED, TWO_REBASED, commit('7'.repeat(40), 'Merge main', 'm', 1, 2)), reason: /merge commit 777777777/u },
    { name: 'the live head is not readable', live: { kind: 'missing' }, reason: /shows no commits of its head ccccccccc over main/u },
    {
      name: 'the live head gained a commit the host shows with no files (T5130 M2)',
      live: read(ONE_REBASED, TWO_REBASED, { sha: '8'.repeat(40), subject: 'chore: empty', parents: 1, files: [] }),
      reason: /shows 888888888 "chore: empty" of its head ccccccccc over main with no files: .*rebase the empty commit away/u,
    },
    { name: 'the live head reads only in part',live: { kind: 'partial', reason: 'it carries 120 commits' }, reason: /it carries 120 commits: an approval carries only over commits read whole/u },
  ];

  for (const refusal of refusals) {
    it(`refuses when ${refusal.name}`, async () => {
      const carry = await pullCarry(hostWith(read(ONE, TWO), refusal.live), TARGET, PULL, APPROVED);
      assert.ok(carry.kind === 'refused' && refusal.reason.test(carry.reason), JSON.stringify(carry));
    });
  }

  it('refuses when the approved head is not readable any more, or carries no work', async () => {
    const gone = await pullCarry(hostWith({ kind: 'missing' }, read(ONE_REBASED)), TARGET, PULL, APPROVED);
    assert.ok(gone.kind === 'refused' && gone.reason.includes('the approved head aaaaaaaaa over main'), JSON.stringify(gone));
    const empty = await pullCarry(hostWith(read(), read(ONE_REBASED)), TARGET, PULL, APPROVED);
    assert.ok(empty.kind === 'refused' && empty.reason.includes('carries no commit over main'), JSON.stringify(empty));
  });

  it('fails when the code host could not be read', async () => {
    assert.deepEqual(await pullCarry(hostWith(read(ONE), { kind: 'failed', reason: 'gh timed out' }), TARGET, PULL, APPROVED), { kind: 'failed', reason: 'gh timed out' });
  });
});
