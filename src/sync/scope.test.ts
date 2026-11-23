import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HostIssue } from '../issues/issue.ts';
import type { SyncPlan, SyncStep } from './plan.ts';
import { capPlan, DEFAULT_CAPS, DEFAULT_SCOPE, inScope, scopeIssues, type ScopeRequest } from './scope.ts';

function issue(number: number, overrides: Partial<HostIssue> = {}): HostIssue {
  return {
    repo: 'ENG',
    number,
    title: `Issue ${number}`,
    body: '',
    state: 'open',
    stateReason: '',
    labels: [],
    assignees: [],
    url: `https://acme.atlassian.net/browse/ENG-${number}`,
    updatedAt: `2030-01-${String(10 + (number % 10)).padStart(2, '0')}T00:00:00Z`,
    closedAt: undefined,
    lastEditedAt: undefined,
    authorAssociation: '',
    author: 'someone',
    authorKind: 'atlassian',
    labelEvents: [],
    renamedAt: undefined,
    createdAt: undefined,
    comments: [],
    linkedPulls: 0,
    ...overrides,
  };
}

const request = (overrides: Partial<ScopeRequest> = {}): ScopeRequest => ({ scope: DEFAULT_SCOPE, people: ['acc-1'], held: [], ...overrides });

const refOf = (found: HostIssue): string => `jira:ENG-${found.number}`;

function addStep(number: number): SyncStep {
  return { kind: 'add', ref: `jira:ENG-${number}`, input: { title: `Issue ${number}`, description: null, owner: 'teamrig', ref: `jira:ENG-${number}`, priority: 2 } };
}

function planOf(steps: readonly SyncStep[]): SyncPlan {
  return { steps, inserted: steps.filter((step) => step.kind === 'add').length, changed: 0, unchanged: 0, leftOut: [] };
}

describe('inScope', () => {
  it('takes an issue assigned to one of the team people, without case', () => {
    assert.equal(inScope(issue(1, { assignees: ['ACC-1'] }), request()), true);
  });

  it('takes an issue carrying a scope label, without case, whoever it is assigned to', () => {
    assert.equal(inScope(issue(2, { labels: ['TeamRig'], assignees: ['acc-9'] }), request()), true);
  });

  it('leaves out an issue assigned to someone else and carrying no scope label', () => {
    assert.equal(inScope(issue(3, { assignees: ['acc-9'], labels: ['bug'] }), request()), false);
  });

  it('takes a held issue outside the scope, so its close still reaches its task', () => {
    assert.equal(inScope(issue(4, { state: 'closed' }), request({ held: [4] })), true);
  });

  it('takes no assigned issue with assigned none', () => {
    assert.equal(inScope(issue(5, { assignees: ['acc-1'] }), request({ scope: { ...DEFAULT_SCOPE, assigned: 'none' } })), false);
  });

  it('takes every issue with all', () => {
    assert.equal(inScope(issue(6), request({ scope: { ...DEFAULT_SCOPE, all: true } })), true);
  });
});

describe('scopeIssues', () => {
  it('keeps the tracker order and counts what it gave outside the scope', () => {
    const scoped = scopeIssues([issue(1, { assignees: ['acc-1'] }), issue(2), issue(3, { labels: ['teamrig'] })], request());
    assert.deepEqual(scoped.issues.map((found) => found.number), [1, 3]);
    assert.equal(scoped.outside, 1);
  });
});

describe('capPlan', () => {
  it('leaves a plan within both caps as it is', () => {
    const plan = planOf([addStep(1), addStep(2)]);
    assert.deepEqual(capPlan(plan, [issue(1), issue(2)], refOf, request(), DEFAULT_CAPS, 0), { plan, held: 0, key: undefined });
  });

  it('cuts the adds to maxNewPerSync, assigned issues first, then the one changed longest ago', () => {
    const issues = [issue(1, { updatedAt: '2030-01-03T00:00:00Z' }), issue(2, { updatedAt: '2030-01-01T00:00:00Z' }), issue(3, { assignees: ['acc-1'], updatedAt: '2030-01-09T00:00:00Z' })];
    const capped = capPlan(planOf([addStep(1), addStep(2), addStep(3)]), issues, refOf, request(), { maxOpen: 200, maxNewPerSync: 2 }, 0);
    assert.deepEqual(capped.plan.steps.map((step) => step.ref), ['jira:ENG-2', 'jira:ENG-3']);
    assert.equal(capped.plan.inserted, 2);
    assert.equal(capped.held, 1);
    assert.equal(capped.key, 'maxNewPerSync');
  });

  it('adds nothing once the open tasks reach maxOpen, and names that key', () => {
    const capped = capPlan(planOf([addStep(1)]), [issue(1)], refOf, request(), { maxOpen: 3, maxNewPerSync: 50 }, 3);
    assert.deepEqual(capped.plan.steps, []);
    assert.equal(capped.held, 1);
    assert.equal(capped.key, 'maxOpen');
  });

  it('never cuts an update or a status change of a held task', () => {
    const status: SyncStep = { kind: 'status', ref: 'jira:ENG-9', id: 'T9', input: { status: 'done' } };
    const capped = capPlan(planOf([status, addStep(1)]), [issue(1), issue(9)], refOf, request(), { maxOpen: 0, maxNewPerSync: 50 }, 5);
    assert.deepEqual(capped.plan.steps, [status]);
  });

  it('keeps the same adds on a rerun', () => {
    const issues = [issue(1), issue(2), issue(3)];
    const plan = planOf([addStep(3), addStep(1), addStep(2)]);
    const first = capPlan(plan, issues, refOf, request(), { maxOpen: 200, maxNewPerSync: 1 }, 0);
    const again = capPlan(plan, [...issues].reverse(), refOf, request(), { maxOpen: 200, maxNewPerSync: 1 }, 0);
    assert.deepEqual(again.plan.steps, first.plan.steps);
  });
});
