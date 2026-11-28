import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { landedRun, type WorkCommit, workChanges } from './work-commits.ts';

describe('workChanges: how a head differs from the approved one, commit for commit (T2913)', () => {
  const commit = (sha: string, subject: string, patch: string, merge = false): WorkCommit => ({ sha, subject, merge, patch });
  const A = commit('aaaaaaaaaa', 'core: a', 'pa');
  const B = commit('bbbbbbbbbb', 'docs: b', 'pb');

  it('finds none when the patches match in order, whatever the shas', () => {
    assert.deepEqual(workChanges([A, B], [commit('a2', 'core: a', 'pa'), commit('b2', 'docs: b', 'pb')]), []);
    assert.deepEqual(workChanges([], []), []);
  });

  it('names a changed commit by its subject, a dropped and an added one', () => {
    assert.deepEqual(workChanges([A, B], [commit('a222222222', 'core: a', 'pa2'), B]), ['changed aaaaaaaaa "core: a", now a22222222']);
    assert.deepEqual(workChanges([A, B], [A]), ['dropped bbbbbbbbb "docs: b"']);
    assert.deepEqual(workChanges([A], [A, B]), ['added bbbbbbbbb "docs: b"']);
  });

  it('names a reorder and any merge commit on either side', () => {
    assert.deepEqual(workChanges([A, B], [B, A]), ['reordered, now bbbbbbbbb, aaaaaaaaa']);
    const merge = commit('mmmmmmmmmm', 'merge main', '', true);
    assert.deepEqual(workChanges([A], [A, merge]), ['merge commit mmmmmmmmm "merge main": rebase it away']);
    assert.deepEqual(workChanges([A, merge], [A]), ['merge commit mmmmmmmmm "merge main": rebase it away']);
  });
});

describe("landedRun: a stacked branch's leading commits main holds under other shas (T3343)", () => {
  const commit = (sha: string, patch: string, merge = false): WorkCommit => ({ sha, subject: sha, merge, patch });
  const P = commit('p', 'pp');
  const Q = commit('q', 'pq');
  const C = commit('c', 'pc');
  const main = [commit('p2', 'pp'), commit('q2', 'pq'), commit('m', 'pm')];

  it('is the leading run of commits whose patch main carries', () => {
    assert.deepEqual(landedRun([P, Q, C], main), [P, Q]);
    assert.deepEqual(landedRun([C, P], main), [], 'a landed commit after the own work stays the branch\'s own');
    assert.deepEqual(landedRun([P, commit('x', '', true), Q, C], main), [P], 'a merge commit ends the run');
  });

  it('is empty when every commit is landed, as no work of the branch is left to approve', () => {
    assert.deepEqual(landedRun([P, Q], main), []);
    assert.deepEqual(landedRun([], main), []);
  });

  it("never matches a main merge commit's empty patch", () => {
    assert.deepEqual(landedRun([commit('e', ''), C], [commit('mm', '', true)]), []);
  });
});
