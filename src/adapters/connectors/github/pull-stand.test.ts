import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ghPullStand, STAND_HEAD } from '../../../testing/fake-gh.ts';
import { pullStandIn } from './pull-stand.ts';

/** An answer to the stand query holding `repository` as gh prints it. */
function answer(repository: unknown): string {
  return JSON.stringify({ data: { repository } });
}

describe('pullStandIn (T4817)', () => {
  it('reads an open pull request on a branch with no merge queue', () => {
    assert.deepEqual(pullStandIn(answer(ghPullStand())), {
      kind: 'read',
      pull: { id: 'PR_kwDOAbc', state: 'open', draft: false, head: STAND_HEAD, base: 'main', defaultBranch: 'main', mergeQueue: false, queued: false, conflicts: false },
    });
  });

  it('reads the merge queue, an entry in it, a draft, a conflict, another base and a merged or closed state', () => {
    const read = pullStandIn(answer(ghPullStand({ mergeQueue: true, queued: true, isDraft: true, mergeable: 'CONFLICTING', base: 'next', state: 'MERGED' })));
    assert.deepEqual(read.kind === 'read' ? read.pull : undefined, {
      id: 'PR_kwDOAbc',
      state: 'merged',
      draft: true,
      head: STAND_HEAD,
      base: 'next',
      defaultBranch: 'main',
      mergeQueue: true,
      queued: true,
      conflicts: true,
    });
    const closed = pullStandIn(answer(ghPullStand({ state: 'CLOSED' })));
    assert.equal(closed.kind === 'read' && closed.pull.state, 'closed');
  });

  it('counts only CONFLICTING as conflicts: GitHub still working it out is left to its own gate', () => {
    const unknown = pullStandIn(answer(ghPullStand({ mergeable: 'UNKNOWN' })));
    assert.equal(unknown.kind === 'read' && unknown.pull.conflicts, false);
  });

  it('gives missing when GitHub answers no pull request of that number', () => {
    assert.deepEqual(pullStandIn(answer({ ...ghPullStand(), pullRequest: null })), { kind: 'missing' });
  });

  it('gives unreadable for an answer off its shape, so nothing acts on half a read', () => {
    const pull = { ...ghPullStand() };
    const unreadable: string[] = [
      'not json',
      JSON.stringify({ data: { repository: null } }),
      answer({ ...pull, defaultBranchRef: null }),
      answer({ ...pull, mergeQueue: 'yes' }),
      answer({ ...pull, pullRequest: 'PR_1' }),
      answer({ ...pull, pullRequest: { ...ghPullStandPull(), state: 'constructor' } }),
      answer({ ...pull, pullRequest: { ...ghPullStandPull(), isDraft: 'false' } }),
      answer({ ...pull, pullRequest: { ...ghPullStandPull(), headRefOid: null } }),
      answer({ ...pull, pullRequest: { ...ghPullStandPull(), mergeable: null } }),
      answer({ ...pull, pullRequest: { ...ghPullStandPull(), mergeQueueEntry: 'QUEUED' } }),
    ];
    for (const stdout of unreadable) {
      assert.deepEqual(pullStandIn(stdout), { kind: 'unreadable' }, stdout);
    }
  });
});

/** The pull request part of a default stand, to spread with one field off its shape. */
function ghPullStandPull(): Record<string, unknown> {
  const { pullRequest } = ghPullStand();
  return typeof pullRequest === 'object' && pullRequest !== null ? { ...pullRequest } : {};
}
