import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { testTask } from '../testing/task.ts';
import { byCloseOrder, overTabCap, tabCapHoldText, type CapCandidate } from './tab-cap.ts';

const IDLE: CapCandidate = { id: 'delta', top: undefined };
const P0: CapCandidate = { id: 'alpha', top: testTask({ id: 'T1', priority: 0 }) };
const P2_OLD: CapCandidate = { id: 'bravo', top: testTask({ id: 'T2', priority: 2 }) };
const P2_NEW: CapCandidate = { id: 'charlie', top: testTask({ id: 'T9', priority: 2 }) };

function idsOf(candidates: readonly CapCandidate[]): readonly string[] {
  return candidates.map((each) => each.id);
}

describe('byCloseOrder', () => {
  it('closes a session with no work first, then the least urgent top task first, the newest task before an older one', () => {
    assert.deepEqual(idsOf([P0, P2_OLD, IDLE, P2_NEW].sort(byCloseOrder)), ['delta', 'charlie', 'bravo', 'alpha']);
  });

  it('breaks a tie by id, so two runs agree', () => {
    const echo: CapCandidate = { id: 'echo', top: undefined };
    assert.deepEqual(idsOf([echo, IDLE].sort(byCloseOrder)), ['delta', 'echo']);
  });
});

describe('overTabCap', () => {
  const candidates = [P0, P2_OLD, IDLE, P2_NEW];

  it('picks the open - maxTabs lowest-ranked sessions', () => {
    assert.deepEqual(idsOf(overTabCap(candidates, 8, 6)), ['delta', 'charlie']);
  });

  it('picks none at or under the cap, or with no cap set', () => {
    assert.deepEqual(overTabCap(candidates, 6, 6), []);
    assert.deepEqual(overTabCap(candidates, 3, 6), []);
    assert.deepEqual(overTabCap(candidates, 16, undefined), []);
  });

  it('picks every candidate when the tabs over the cap outnumber them (the lead counts, but is never a candidate)', () => {
    assert.deepEqual(idsOf(overTabCap([P0, IDLE], 9, 1)), ['delta', 'alpha']);
  });
});

describe('tabCapHoldText', () => {
  it('names the tabs open, the cap and its key', () => {
    assert.equal(tabCapHoldText(7, 6), 'the team has 7 tabs open, over its cap of 6 (open.headroom.maxTabs)');
  });
});
