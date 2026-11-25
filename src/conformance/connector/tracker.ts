import assert from 'node:assert/strict';
import type { CloseReason, IssueTarget, Tracker } from '../../plugin-api/index.ts';
import { defineContract, type Contract, type ContractCase, type Subject } from '../contract.ts';
import { nothingTracker, yesTracker } from './reference.ts';

type Awaitable<T> = T | Promise<T>;

/** The part of a tracker this contract holds: the writes a team makes on its issues, and the one read a write needs first. */
export type TrackerPort = Pick<Tracker, 'open' | 'comment' | 'editBody' | 'close' | 'labelExists' | 'addLabels' | 'removeLabel' | 'assign' | 'unassign'>;

/** One issue as the tracker itself holds it, read past the port. */
export interface WorldIssue {
  readonly title: string;
  readonly body: string;
  readonly state: 'open' | 'closed';
  /** Why it was closed, in the port's words; undefined while it is open. */
  readonly reason: CloseReason | undefined;
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
  /** Each comment's text, oldest first. */
  readonly comments: readonly string[];
}

/**
 * What a tracker's port sees, as a case scripts and reads it: the tracker itself, faked (GitHub's gh, Jira's REST
 * API). A case never believes an answer alone; it reads here what the tracker really holds.
 */
export interface TrackerWorld {
  /** The place the cases file their issues in, as the port names it (`owner/name`, Jira `<site>/<project key>`). */
  readonly repo: string;
  /** Files an issue on the tracker by hand, as a person does, open with no labels or assignees, and answers it. */
  readonly fileByHand: (title: string, body: string) => Awaitable<IssueTarget>;
  /** Makes a label in the place, as a person does. */
  readonly makeLabel: (name: string) => Awaitable<void>;
  /** Adds a person who may be assigned in the place, by the login or account id the port names them by. */
  readonly addPerson: (login: string) => Awaitable<void>;
  /** The issue as the tracker holds it now; undefined when it holds none at the target. */
  readonly issue: (target: IssueTarget) => Awaitable<WorldIssue | undefined>;
}

export type TrackerSubject = Subject<TrackerPort, TrackerWorld>;
export type TrackerCase = ContractCase<TrackerPort, TrackerWorld, 'connector'>;

/** Labels and people with no space or capital letter, which every tracker takes as they are. */
const LABEL = 'bug';
const OTHER_LABEL = 'needs-review';
const PERSON = 'ana';

function done(end: { readonly kind: string; readonly reason?: string }, what: string): void {
  if (end.kind !== 'done') {
    assert.fail(`${what} answered ${end.kind}${end.reason === undefined ? '' : `: ${end.reason}`}`);
  }
}

async function held(world: TrackerWorld, target: IssueTarget): Promise<WorldIssue> {
  const issue = await world.issue(target);
  if (issue === undefined) {
    assert.fail(`the tracker holds no issue at ${target.repo}#${String(target.number)}`);
  }
  return issue;
}

/** An issue a person filed: what the cases that write on one start from. */
async function filed(world: TrackerWorld): Promise<IssueTarget> {
  return world.fileByHand('Crash on start', 'It stops at once.');
}

/** A target the tracker holds no issue at. */
function missing(world: TrackerWorld): IssueTarget {
  return { repo: world.repo, number: 9999 };
}

const OPEN_FILES_THE_ISSUE: TrackerCase = {
  id: 'tracker.open-files-the-issue',
  title: 'opens an issue with the title, body and labels it is given, and answers where it is',
  features: ['tracker.issue-open'],
  run: async ({ port, world }) => {
    await world.makeLabel(LABEL);
    const answer = await port.open({ repo: world.repo, title: 'Add a dark theme', body: 'The pane is too bright at night.', labels: [LABEL] });
    if (answer.kind !== 'opened') {
      assert.fail(`open answered failed: ${answer.reason}`);
    }
    assert.equal(answer.target.repo, world.repo);
    const issue = await held(world, answer.target);
    assert.deepEqual(
      { title: issue.title, body: issue.body, state: issue.state, labels: issue.labels },
      { title: 'Add a dark theme', body: 'The pane is too bright at night.', state: 'open', labels: [LABEL] },
    );
  },
};

const OPEN_NUMBERS_DIFFER: TrackerCase = {
  id: 'tracker.open-numbers-differ',
  title: 'answers a different issue for each one it opens',
  features: ['tracker.issue-open'],
  run: async ({ port, world }) => {
    const first = await port.open({ repo: world.repo, title: 'First', body: 'One.', labels: [] });
    const second = await port.open({ repo: world.repo, title: 'Second', body: 'Two.', labels: [] });
    if (first.kind !== 'opened' || second.kind !== 'opened') {
      assert.fail('an open failed');
    }
    assert.notEqual(first.target.number, second.target.number);
    assert.deepEqual([(await held(world, first.target)).title, (await held(world, second.target)).title], ['First', 'Second']);
  },
};

const COMMENT_POSTS_ON_THE_ISSUE: TrackerCase = {
  id: 'tracker.comment-posts-on-the-issue',
  title: 'posts each comment once, in order, on the issue it names, and changes nothing else of it',
  features: ['tracker.comment'],
  run: async ({ port, world }) => {
    const target = await filed(world);
    done(await port.comment(target, 'I can reproduce it.'), 'comment');
    done(await port.comment(target, 'Fixed on main.'), 'comment');
    const issue = await held(world, target);
    assert.deepEqual(issue.comments, ['I can reproduce it.', 'Fixed on main.']);
    assert.deepEqual({ title: issue.title, body: issue.body, state: issue.state }, { title: 'Crash on start', body: 'It stops at once.', state: 'open' });
  },
};

const COMMENT_ON_A_MISSING_ISSUE_FAILS: TrackerCase = {
  id: 'tracker.comment-on-a-missing-issue-fails',
  title: 'answers failed for a comment on an issue the tracker does not hold',
  features: ['tracker.comment'],
  run: async ({ port, world }) => {
    const target = missing(world);
    assert.equal((await port.comment(target, 'Anyone there?')).kind, 'failed');
    assert.equal(await world.issue(target), undefined);
  },
};

const EDIT_BODY_REPLACES_ONLY_THE_BODY: TrackerCase = {
  id: 'tracker.edit-body-replaces-only-the-body',
  title: "replaces an issue's body, its title, state and comments kept",
  features: ['tracker.edit-body'],
  run: async ({ port, world }) => {
    const target = await filed(world);
    done(await port.editBody(target, 'It stops at once, on every OS.'), 'editBody');
    const issue = await held(world, target);
    assert.deepEqual(
      { title: issue.title, body: issue.body, state: issue.state, comments: issue.comments },
      { title: 'Crash on start', body: 'It stops at once, on every OS.', state: 'open', comments: [] },
    );
  },
};

const EDIT_BODY_OF_A_MISSING_ISSUE_FAILS: TrackerCase = {
  id: 'tracker.edit-body-of-a-missing-issue-fails',
  title: 'answers failed for a body edit of an issue the tracker does not hold',
  features: ['tracker.edit-body'],
  run: async ({ port, world }) => {
    const target = missing(world);
    assert.equal((await port.editBody(target, 'New text.')).kind, 'failed');
    assert.equal(await world.issue(target), undefined);
  },
};

const CLOSE_AS_COMPLETED: TrackerCase = {
  id: 'tracker.close-as-completed',
  title: 'closes an issue as completed',
  features: ['tracker.close'],
  run: async ({ port, world }) => {
    const target = await filed(world);
    done(await port.close(target, 'completed'), 'close');
    const issue = await held(world, target);
    assert.deepEqual({ state: issue.state, reason: issue.reason }, { state: 'closed', reason: 'completed' });
  },
};

const CLOSE_AS_NOT_PLANNED: TrackerCase = {
  id: 'tracker.close-as-not-planned',
  title: 'closes an issue as not planned, so the tracker tells it from a completed one',
  features: ['tracker.close'],
  run: async ({ port, world }) => {
    const target = await filed(world);
    done(await port.close(target, 'not-planned'), 'close');
    const issue = await held(world, target);
    assert.deepEqual({ state: issue.state, reason: issue.reason }, { state: 'closed', reason: 'not-planned' });
  },
};

const LABELS_ADDED_AND_TAKEN_OFF: TrackerCase = {
  id: 'tracker.labels-added-and-taken-off',
  title: 'adds labels to an issue and takes one off, the rest kept',
  features: ['tracker.labels'],
  run: async ({ port, world }) => {
    await world.makeLabel(LABEL);
    await world.makeLabel(OTHER_LABEL);
    const target = await filed(world);
    done(await port.addLabels(target, [LABEL, OTHER_LABEL]), 'addLabels');
    assert.deepEqual([...(await held(world, target)).labels].sort(), [LABEL, OTHER_LABEL]);
    done(await port.removeLabel(target, LABEL), 'removeLabel');
    assert.deepEqual((await held(world, target)).labels, [OTHER_LABEL]);
  },
};

const LABEL_EXISTS_TELLS_EACH: TrackerCase = {
  id: 'tracker.label-exists-tells-each',
  title: 'says a label the place has is found, and one it lacks is missing',
  features: ['tracker.labels'],
  run: async ({ port, world }) => {
    await world.makeLabel(LABEL);
    assert.deepEqual([(await port.labelExists(world.repo, LABEL)).kind, (await port.labelExists(world.repo, 'no-such-label')).kind], ['found', 'missing']);
  },
};

const ASSIGN_AND_UNASSIGN: TrackerCase = {
  id: 'tracker.assign-and-unassign',
  title: 'assigns a person to an issue and takes them off again',
  features: ['tracker.assign'],
  run: async ({ port, world }) => {
    await world.addPerson(PERSON);
    const target = await filed(world);
    done(await port.assign(target, [PERSON]), 'assign');
    assert.deepEqual((await held(world, target)).assignees, [PERSON]);
    done(await port.unassign(target, PERSON), 'unassign');
    assert.deepEqual((await held(world, target)).assignees, []);
  },
};

/**
 * What every tracker must do with a team's issues, whatever tool holds them. The cases on a missing issue are the
 * contract's negative tests: a tracker that answers done for a write it could not make fails them.
 */
export const TRACKER_CONTRACT: Contract<TrackerPort, TrackerWorld, 'connector'> = defineContract({
  port: 'tracker',
  side: 'connector',
  cases: [
    OPEN_FILES_THE_ISSUE,
    OPEN_NUMBERS_DIFFER,
    COMMENT_POSTS_ON_THE_ISSUE,
    COMMENT_ON_A_MISSING_ISSUE_FAILS,
    EDIT_BODY_REPLACES_ONLY_THE_BODY,
    EDIT_BODY_OF_A_MISSING_ISSUE_FAILS,
    CLOSE_AS_COMPLETED,
    CLOSE_AS_NOT_PLANNED,
    LABELS_ADDED_AND_TAKEN_OFF,
    LABEL_EXISTS_TELLS_EACH,
    ASSIGN_AND_UNASSIGN,
  ],
  liars: [nothingTracker, yesTracker],
});
