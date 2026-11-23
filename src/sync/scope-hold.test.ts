import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { SyncPlan } from './plan.ts';
import { formatScopeFile, gateScope, heldScopeLine, holdAdds, parseScopeFile, sameMark, scopeMark, widens, type ScopeMark } from './scope-hold.ts';
import type { ScopeRequest } from './scope.ts';

const TEAM: ScopeMark = { all: false, assigned: 'team', labels: ['teamrig'], people: ['a-me'] };

function request(scope: Partial<ScopeRequest['scope']>, people: readonly string[]): ScopeRequest {
  return { scope: { all: false, assigned: 'team', labels: ['teamrig'], ...scope }, people, held: [7] };
}

describe('scopeMark', () => {
  it('keeps labels and people in lower case, sorted, once each, and drops what the scope does not read', () => {
    assert.deepEqual(scopeMark(request({ labels: ['TeamRig', 'ops', 'teamrig'] }, ['B', 'a', 'b'])), { all: false, assigned: 'team', labels: ['ops', 'teamrig'], people: ['a', 'b'] });
    assert.deepEqual(scopeMark(request({ assigned: 'none' }, ['a'])).people, []);
    assert.deepEqual(scopeMark(request({ all: true }, ['a'])), { all: true, assigned: 'team', labels: [], people: [] });
  });
});

describe('widens', () => {
  it('holds a place never taken, and one that came to read every issue', () => {
    assert.equal(widens(undefined, TEAM), true);
    assert.equal(widens(TEAM, { ...TEAM, all: true, labels: [], people: [] }), true);
  });

  it('holds a new label, a new person, and assignees counted after labels alone', () => {
    assert.equal(widens(TEAM, { ...TEAM, labels: ['ops', 'teamrig'] }), true);
    assert.equal(widens(TEAM, { ...TEAM, people: ['a-me', 'a-you'] }), true);
    assert.equal(widens({ ...TEAM, assigned: 'none', people: [] }, TEAM), true);
  });

  it('lets a scope that is the same or narrower through', () => {
    assert.equal(widens(TEAM, TEAM), false);
    assert.equal(widens(TEAM, { ...TEAM, labels: [], people: [] }), false);
    assert.equal(widens(TEAM, { ...TEAM, assigned: 'none', people: [] }), false);
    assert.equal(widens({ all: true, assigned: 'team', labels: [], people: [] }, TEAM), false);
  });

  it('calls two marks the same only when neither widens the other', () => {
    assert.equal(sameMark(TEAM, { ...TEAM }), true);
    assert.equal(sameMark(TEAM, { ...TEAM, labels: [] }), false);
    assert.equal(sameMark(undefined, TEAM), false);
  });
});

describe('holdAdds', () => {
  it('holds every add and keeps the changes of held tasks', () => {
    const plan: SyncPlan = {
      steps: [
        { kind: 'add', ref: 'jira:ENG-1', input: { title: 'One', description: null, owner: 'lead', ref: 'jira:ENG-1', priority: 2 } },
        { kind: 'status', ref: 'jira:ENG-2', id: 'T2', input: { status: 'done', note: 'closed on Jira', evidence: 'https://acme.atlassian.net/browse/ENG-2' } },
      ],
      inserted: 1,
      changed: 1,
      unchanged: 0,
      leftOut: [],
    };
    const held = holdAdds(plan);
    assert.equal(held.held, 1);
    assert.equal(held.plan.inserted, 0);
    assert.deepEqual(held.plan.steps.map((step) => step.kind), ['status']);
  });
});

describe('gateScope', () => {
  const plan: SyncPlan = {
    steps: [
      { kind: 'add', ref: 'jira:ENG-1', input: { title: 'One', description: null, owner: 'lead', ref: 'jira:ENG-1', priority: 2 } },
      { kind: 'status', ref: 'jira:ENG-2', id: 'T2', input: { status: 'done', note: 'closed on Jira', evidence: 'https://acme.atlassian.net/browse/ENG-2' } },
    ],
    inserted: 1,
    changed: 1,
    unchanged: 0,
    leftOut: [],
  };
  const WIDER: ScopeMark = { ...TEAM, labels: ['ops', 'teamrig'] };

  it('changes nothing on a preview, and takes the scope on a person\'s --yes', () => {
    const place = { taken: TEAM, told: WIDER };
    assert.deepEqual(gateScope('preview', place, WIDER, plan), { plan, held: 0, tell: false, place });
    assert.deepEqual(gateScope('yes', place, WIDER, plan), { plan, held: 0, tell: false, place: { taken: WIDER, told: undefined } });
  });

  it('holds the adds of a place never taken, keeps its changes, and tells the lead once', () => {
    const first = gateScope('auto', undefined, TEAM, plan);
    assert.deepEqual(first.plan.steps.map((step) => step.kind), ['status']);
    assert.equal(first.held, 1);
    assert.equal(first.tell, true);
    assert.deepEqual(first.place, { taken: undefined, told: TEAM });
    const again = gateScope('auto', first.place, TEAM, plan);
    assert.equal(again.held, 1);
    assert.equal(again.tell, false);
  });

  it('tells the lead again when the scope widens past what it was told', () => {
    const gate = gateScope('auto', { taken: TEAM, told: TEAM }, WIDER, plan);
    assert.equal(gate.tell, true);
    assert.deepEqual(gate.place, { taken: TEAM, told: WIDER });
  });

  it('tells nothing when a wider scope has nothing to add', () => {
    const quiet = { ...plan, steps: plan.steps.filter((step) => step.kind !== 'add'), inserted: 0 };
    assert.deepEqual(gateScope('auto', { taken: TEAM, told: undefined }, WIDER, quiet), { plan: quiet, held: 0, tell: false, place: { taken: TEAM, told: undefined } });
  });

  it('lets the same or a narrower scope through, and takes the narrower one so a widening later is held', () => {
    assert.deepEqual(gateScope('auto', { taken: TEAM, told: undefined }, TEAM, plan), { plan, held: 0, tell: false, place: { taken: TEAM, told: undefined } });
    const narrow: ScopeMark = { ...TEAM, labels: [] };
    const gate = gateScope('auto', { taken: TEAM, told: undefined }, narrow, plan);
    assert.equal(gate.held, 0);
    assert.deepEqual(gate.place?.taken, narrow);
    assert.equal(gateScope('auto', gate.place, TEAM, plan).held, 1);
  });
});

describe('the scope file', () => {
  it('reads back what it wrote', () => {
    const places = new Map([
      ['acme/eng', { taken: TEAM, told: undefined }],
      ['acme/ops', { taken: undefined, told: { ...TEAM, labels: ['ops'] } }],
    ]);
    assert.deepEqual(parseScopeFile(formatScopeFile(places)), places);
  });

  it('reads a broken file, or one of another format, as no place, so each waits for a person again', () => {
    assert.equal(parseScopeFile('{').size, 0);
    assert.equal(parseScopeFile('{"format":2,"places":{"acme/eng":{}}}').size, 0);
    assert.deepEqual(parseScopeFile('{"format":1,"places":{"acme/eng":{"taken":{"all":"yes"}}}}').get('acme/eng'), { taken: undefined, told: undefined });
  });
});

describe('heldScopeLine', () => {
  it('names the place, the adds waiting and the cap, and how to take them', () => {
    assert.equal(
      heldScopeLine('jira', 'acme/eng', 812, 50),
      'jira acme/eng: the import scope is new or wider; 812 issue(s) would be added (50 a run at most). Run teamrig issue sync to review it, --yes to take it',
    );
  });
});
