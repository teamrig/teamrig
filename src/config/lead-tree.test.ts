import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LeadTree } from './lead-tree.ts';

/** The lead over bravo, charlie and delta. */
const TREE = new LeadTree({ sessions: ['lead', 'bravo', 'charlie', 'delta'], roles: { lead: 'lead' } });

describe('LeadTree', () => {
  it('gives every other session the lead as its leader, and the lead and an id off the team none', () => {
    assert.deepEqual(
      ['lead', 'bravo', 'charlie', 'delta', 'zulu'].map((id) => TREE.leaderOf(id)),
      [undefined, 'lead', 'lead', 'lead', undefined],
    );
  });

  it('walks the chain up to the lead', () => {
    assert.deepEqual(TREE.chainOf('delta'), ['lead']);
    assert.deepEqual(TREE.chainOf('lead'), []);
    assert.deepEqual(TREE.chainOf('zulu'), []);
  });

  it("lists every other session as the lead's members, and none for anyone else", () => {
    assert.deepEqual(TREE.membersOf('lead'), ['bravo', 'charlie', 'delta']);
    assert.deepEqual(TREE.membersOf('bravo'), []);
  });

  it('knows only the lead leads, and whom', () => {
    assert.deepEqual(
      ['lead', 'bravo', 'charlie'].map((id) => TREE.isLeader(id)),
      [true, false, false],
    );
    assert.equal(TREE.leads('lead', 'delta'), true);
    assert.equal(TREE.leads('bravo', 'delta'), false);
    assert.equal(TREE.leads('lead', 'lead'), false);
    assert.equal(TREE.leads('lead', 'zulu'), false);
  });

  it("has the lead's own work approved by the lead on a root team (T1140)", () => {
    assert.equal(TREE.above, undefined);
    assert.deepEqual(['lead', 'delta', 'zulu'].map((id) => TREE.approversOf(id)), [['lead'], ['lead'], ['lead']]);
  });

  it("has a child team's lead approved by the parent team's lead, its members by the lead (T1140)", () => {
    const child = new LeadTree({ sessions: ['lead', 'bravo', 'charlie'], roles: { lead: 'lead' } }, { team: 'app', id: 'boss' });
    assert.equal(child.above, 'app/boss');
    assert.deepEqual(['lead', 'bravo', 'charlie', 'zulu'].map((id) => child.approversOf(id)), [['app/boss'], ['lead'], ['lead'], ['lead']]);
    assert.deepEqual([child.leaderOf('lead'), child.chainOf('lead'), child.membersOf('lead')], [undefined, [], ['bravo', 'charlie']]);
  });
});
