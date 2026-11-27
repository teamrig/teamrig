import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HostIssue } from '../../issues/issue.ts';
import type { Task } from '../../register/fold.ts';
import { GITHUB_TRACKER, importRules, issueRef } from '../../sync/map.ts';
import { planSync, type SyncPlan } from '../../sync/plan.ts';
import { scopeMark } from '../../sync/scope-hold.ts';
import type { ScopeRequest } from '../../sync/scope.ts';
import { testConfig } from '../../testing/config.ts';
import { testHostIssue } from '../../testing/host-issue.ts';
import { testTask } from '../../testing/task.ts';
import { addsOf, heldAt, narrowLines, scopeLines, scopePlace, scopeRequestOf, type PlaceScopeRun } from './import-scope.ts';

const RULES = importRules(testConfig());
const plan = (issues: readonly HostIssue[]): SyncPlan => planSync(issues, new Map(), RULES, GITHUB_TRACKER);
/** The team's scope at acme/web: issues labelled teamrig or assigned to login ada, and held issue 9. */
const REQUEST: ScopeRequest = { scope: { all: false, assigned: 'team', labels: ['teamrig'] }, people: ['ada'], held: [9] };
const RUN: PlaceScopeRun = {
  kind: 'yes',
  source: 'github',
  target: 'acme/web',
  sync: { maxOpen: 200, maxNewPerSync: 50 },
  request: REQUEST,
  taken: undefined,
  active: 0,
  plannedAdds: 0,
  refOf: (issue) => issueRef(issue.repo, issue.number),
};
/** Issue 1 labelled, 2 assigned to ada, 3 a stranger's, 9 held. */
const ISSUES = [testHostIssue(1, { labels: ['TeamRig'] }), testHostIssue(2, { assignees: ['Ada'] }), testHostIssue(3, { assignees: ['someone'] }), testHostIssue(9)];
/** The line acme/web gets while no person took its scope. */
const NARROW = `SCOPE acme/web: the import reads only the team's people's issues, those labelled teamrig and the issues its tasks hold; "sync": { "scope": { "all": true } } in the team config reads every open issue`;

describe('scopePlace (T5128)', () => {
  it('keeps the labelled, the team-assigned and the held issues, and says how many it dropped', () => {
    const scoped = scopePlace(RUN, ISSUES, plan);
    assert.deepEqual(scoped.issues.map((issue) => issue.number), [1, 2, 9]);
    assert.equal(addsOf(scoped.plan), 3);
    assert.deepEqual(scoped.scopeLines, [NARROW, 'SCOPE acme/web: 1 issue(s) outside the import scope dropped; sync.scope widens it']);
    assert.deepEqual(scoped.heldLines, []);
    assert.deepEqual(scoped.scopeHolds, []);
    assert.deepEqual(scoped.place, { taken: scopeMark(REQUEST), told: undefined });
  });

  it('caps the adds by what earlier places of the run already planned', () => {
    const scoped = scopePlace({ ...RUN, sync: { maxOpen: 200, maxNewPerSync: 3 }, plannedAdds: 2 }, ISSUES, plan);
    assert.equal(addsOf(scoped.plan), 1);
    assert.deepEqual(scoped.scopeLines.slice(2), ['CAPPED acme/web: 2 more in scope, held for a later run; raise sync.maxNewPerSync or narrow sync.scope']);
  });

  it('counts the adds a preview planned at earlier places as open, since it writes none', () => {
    const scoped = scopePlace({ ...RUN, kind: 'preview', sync: { maxOpen: 4, maxNewPerSync: 50 }, active: 1, plannedAdds: 2 }, ISSUES, plan);
    assert.equal(addsOf(scoped.plan), 1);
    assert.equal(scoped.place, undefined);
  });

  it('holds every add of a scope no person took on an automatic run, with a HELD line and one line for the lead', () => {
    const scoped = scopePlace({ ...RUN, kind: 'auto', sync: { maxOpen: 200, maxNewPerSync: 2 } }, ISSUES, plan);
    assert.equal(addsOf(scoped.plan), 0);
    assert.deepEqual(scoped.scopeLines, [NARROW, 'SCOPE acme/web: 1 issue(s) outside the import scope dropped; sync.scope widens it']);
    assert.deepEqual(scoped.heldLines, ['HELD acme/web: 3 issue(s) of a new or wider import scope wait for teamrig issue sync --yes']);
    assert.equal(scoped.scopeHolds.length, 1);
    assert.match(scoped.scopeHolds[0] ?? '', /^github acme\/web: the import scope is new or wider; 3 issue\(s\) would be added \(2 a run at most\)/);
  });

  it('adds on an automatic run once a person took the same scope', () => {
    const scoped = scopePlace({ ...RUN, kind: 'auto', taken: { taken: scopeMark(REQUEST), told: undefined } }, ISSUES, plan);
    assert.equal(addsOf(scoped.plan), 3);
    assert.deepEqual(scoped.heldLines, []);
    assert.deepEqual(scoped.scopeHolds, []);
    assert.deepEqual(scoped.scopeLines, ['SCOPE acme/web: 1 issue(s) outside the import scope dropped; sync.scope widens it'], 'a taken scope is not told as narrowed again');
  });
});

describe('the narrowed-scope line (T5128)', () => {
  const taken = { taken: scopeMark(REQUEST), told: undefined };

  it('tells a place no person took a scope for what it reads, and the key that reads every open issue', () => {
    assert.deepEqual(narrowLines('acme/web', REQUEST.scope, undefined), [NARROW]);
    assert.deepEqual(narrowLines('acme/web', REQUEST.scope, { taken: undefined, told: scopeMark(REQUEST) }), [NARROW], 'a scope only the lead was told of is not taken');
  });

  it('names labels alone when the scope counts no assignees, and the held issues alone with no label either', () => {
    assert.deepEqual(narrowLines('acme/web', { all: false, assigned: 'none', labels: ['ops', 'teamrig'] }, undefined), [
      'SCOPE acme/web: the import reads only those labelled ops, teamrig and the issues its tasks hold; "sync": { "scope": { "all": true } } in the team config reads every open issue',
    ]);
    assert.match(narrowLines('acme/web', { all: false, assigned: 'none', labels: [] }, undefined)[0] ?? '', /reads only the issues its tasks hold;/);
  });

  it('says nothing once a person took the scope, or when the scope is every issue', () => {
    assert.deepEqual(narrowLines('acme/web', REQUEST.scope, taken), []);
    assert.deepEqual(narrowLines('acme/web', { ...REQUEST.scope, all: true }, undefined), []);
  });
});

describe('the request a place reads (T5013)', () => {
  it('counts the accept label in the scope, once, whatever its case', () => {
    const scope = { all: false, assigned: 'team', labels: ['ops'] } as const;
    assert.deepEqual(scopeRequestOf(scope, 'teamrig', [3]), { scope: { ...scope, labels: ['ops', 'teamrig'] }, people: [], held: [3] });
    assert.deepEqual(scopeRequestOf({ ...scope, labels: ['TeamRig'] }, 'teamrig', []).scope.labels, ['TeamRig']);
  });

  it('holds the issues of the active tasks at the place, by their refs', () => {
    const parse = (ref: string): { repo: string; number: number } | undefined => {
      const found = /^jira:([A-Z]+)-(\d+)$/.exec(ref);
      return found === null ? undefined : { repo: `acme/${(found[1] ?? '').toLowerCase()}`, number: Number(found[2]) };
    };
    const task = (ref: string | null): Task => testTask({ ref });
    assert.deepEqual(heldAt('acme/eng', [task('jira:ENG-4'), task('jira:OPS-5'), task(null), task('gh:x/y#1'), task('jira:ENG-9')], parse), [4, 9]);
  });

  it('says how many adds the caps held back, and by which key', () => {
    const empty = { steps: [], inserted: 0, changed: 0, unchanged: 0, leftOut: [] };
    assert.deepEqual(scopeLines('acme/eng', 0, { plan: empty, held: 0, key: undefined }), []);
    assert.deepEqual(scopeLines('acme/eng', 0, { plan: empty, held: 4, key: 'maxNewPerSync' }), [
      'CAPPED acme/eng: 4 more in scope, held for a later run; raise sync.maxNewPerSync or narrow sync.scope',
    ]);
  });
});
