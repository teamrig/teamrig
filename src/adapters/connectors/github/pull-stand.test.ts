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
      pull: { id: 'PR_kwDOAbc', state: 'open', draft: false, head: STAND_HEAD, base: 'main', defaultBranch: 'main', mergeQueue: false, queued: false, conflicts: false, checks: 'passing' },
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
      checks: 'passing',
    });
    const closed = pullStandIn(answer(ghPullStand({ state: 'CLOSED' })));
    assert.equal(closed.kind === 'read' && closed.pull.state, 'closed');
  });

  it('counts only CONFLICTING as conflicts: GitHub still working it out is left to its own gate', () => {
    const unknown = pullStandIn(answer(ghPullStand({ mergeable: 'UNKNOWN' })));
    assert.equal(unknown.kind === 'read' && unknown.pull.conflicts, false);
  });

  it("reads the head's check rollup: failed and errored as failing, pending and expected as pending, a null rollup as none", () => {
    const checks = (state: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' | null): unknown => {
      const read = pullStandIn(answer(ghPullStand({ checks: state })));
      return read.kind === 'read' ? read.pull.checks : read.kind;
    };
    assert.deepEqual([checks('SUCCESS'), checks('FAILURE'), checks('ERROR'), checks('PENDING'), checks('EXPECTED'), checks(null)], ['passing', 'failing', 'failing', 'pending', 'pending', 'none']);
  });

  it("reads a null rollup from the head's check runs: a suite awaiting approval with no runs beside one that passed is passing (T5164)", () => {
    const checks = (suites: readonly (readonly string[])[]): unknown => {
      const read = pullStandIn(answer(ghPullStand({ checks: null, suites })));
      return read.kind === 'read' ? read.pull.checks : read.kind;
    };
    assert.equal(checks([[], [], ['COMPLETED:SUCCESS', 'COMPLETED:SKIPPED', 'COMPLETED:NEUTRAL']]), 'passing');
    assert.equal(checks([['COMPLETED:SUCCESS', 'IN_PROGRESS']]), 'pending');
    assert.equal(checks([['QUEUED'], ['COMPLETED:FAILURE']]), 'failing');
    for (const conclusion of ['CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']) {
      assert.equal(checks([['COMPLETED:SUCCESS', `COMPLETED:${conclusion}`]]), 'failing', conclusion);
    }
    assert.equal(checks([[], []]), 'none');
  });

  it('reads a null rollup with more suites or runs than the query read as pending, since an unread run could fail (T5164)', () => {
    const stand = ghPullStandPull();
    const read = (checkSuites: unknown): unknown => {
      const got = pullStandIn(answer({ ...ghPullStand(), pullRequest: { ...stand, commits: { nodes: [{ commit: { statusCheckRollup: null, checkSuites } }] } } }));
      return got.kind === 'read' ? got.pull.checks : got.kind;
    };
    const passed = { status: 'COMPLETED', conclusion: 'SUCCESS' };
    assert.equal(read({ totalCount: 21, nodes: [{ checkRuns: { totalCount: 1, nodes: [passed] } }] }), 'pending');
    assert.equal(read({ totalCount: 1, nodes: [{ checkRuns: { totalCount: 51, nodes: [passed] } }] }), 'pending');
    assert.equal(read({ totalCount: 1, nodes: [{ checkRuns: { totalCount: 1, nodes: [passed] } }] }), 'passing');
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
      answer({ ...pull, pullRequest: { ...ghPullStandPull(), commits: undefined } }),
      answer({ ...pull, pullRequest: { ...ghPullStandPull(), commits: { nodes: [] } } }),
      answer({ ...pull, pullRequest: { ...ghPullStandPull(), commits: { nodes: [{ commit: { statusCheckRollup: { state: 'constructor' } } }] } } }),
      answer({ ...pull, pullRequest: { ...ghPullStandPull(), commits: { nodes: [{ commit: { statusCheckRollup: 'SUCCESS' } }] } } }),
      answer({ ...pull, pullRequest: { ...ghPullStandPull(), commits: { nodes: [{ commit: { statusCheckRollup: null } }] } } }),
      answer({ ...pull, pullRequest: { ...ghPullStandPull(), commits: { nodes: [{ commit: { statusCheckRollup: null, checkSuites: { nodes: [] } } }] } } }),
      answer({ ...pull, pullRequest: { ...ghPullStandPull(), commits: { nodes: [{ commit: { statusCheckRollup: null, checkSuites: { totalCount: 1, nodes: [{ checkRuns: null }] } } }] } } }),
      answer({ ...pull, pullRequest: { ...ghPullStandPull(), commits: { nodes: [{ commit: { statusCheckRollup: null, checkSuites: { totalCount: 1, nodes: [{ checkRuns: { totalCount: 1, nodes: [{ status: 'COMPLETED', conclusion: null }] } }] } } }] } } }),
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
