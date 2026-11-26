import assert from 'node:assert/strict';
import { SEARCH_PAGE, type FoundIssue, type HostSearch, type IssueQuery, type IssueState, type IssueTarget, type Tracker } from '../../plugin-api/index.ts';
import { defineContract, type Contract, type ContractCase, type Subject } from '../contract.ts';
import { nothingReads, yesReads } from './reads-reference.ts';

type Awaitable<T> = T | Promise<T>;

/**
 * The part of a tracker this contract holds: the reads a skill makes of a team's issues, one issue by its number and
 * a search by its text. Search is a capability a tracker may lack (`Tracker.search`); an adapter that binds this
 * contract has it.
 */
export type TrackerReadsPort = Pick<Tracker, 'thread'> & { readonly search: NonNullable<Tracker['search']> };

/** An issue as a person files it on the tracker by hand: open with no labels or assignees unless it says so. */
export interface Filing {
  readonly title: string;
  readonly body: string;
  readonly state?: IssueState;
  readonly labels?: readonly string[];
  /** By the login or account id the port names a person by. */
  readonly assignees?: readonly string[];
}

/**
 * What a tracker's reads see, as a case scripts it: the tracker itself, faked (GitHub's gh, Jira's REST API). A case
 * files its issues here, past the port, and holds the port's answers to what it filed.
 */
export interface TrackerReadsWorld {
  /** The place the cases file their issues in, as the port names it (`owner/name`, Jira `<site>/<project key>`). */
  readonly repo: string;
  /** Files an issue on the tracker by hand, as a person does, and answers where it is. */
  readonly file: (issue: Filing) => Awaitable<IssueTarget>;
}

export type TrackerReadsSubject = Subject<TrackerReadsPort, TrackerReadsWorld>;
export type TrackerReadsCase = ContractCase<TrackerReadsPort, TrackerReadsWorld, 'connector'>;

/** A label and a person with no space or capital letter, which every tracker takes as they are. */
const LABEL = 'bug';
const PERSON = 'ana';

/** The issues a search found, or the case fails with why the search did not answer found. */
function found(answer: HostSearch, what: string): { readonly issues: readonly FoundIssue[]; readonly more: boolean } {
  if (answer.kind !== 'found') {
    assert.fail(`${what} answered failed: ${answer.reason}`);
  }
  return { issues: answer.issues, more: answer.more };
}

/** The numbers a search found, sorted, as the cases compare them: a tracker gives its own best match first. */
function numbers(issues: readonly FoundIssue[]): readonly number[] {
  return issues.map((issue) => issue.target.number).sort((a, b) => a - b);
}

function query(words: string, state: IssueQuery['state'] = 'all', kind: IssueQuery['kind'] = 'issue'): IssueQuery {
  return { words, state, kind };
}

const THREAD_READS_THE_ISSUE: TrackerReadsCase = {
  id: 'tracker-reads.thread-reads-the-issue',
  title: 'reads an issue as the tracker holds it: its title, body, state, labels and assignees, and that it is no pull request',
  features: ['tracker.issue-read'],
  run: async ({ port, world }) => {
    const target = await world.file({ title: 'Crash on start', body: 'It stops at once.', labels: [LABEL], assignees: [PERSON] });
    const answer = await port.thread(target);
    if (answer.kind !== 'read') {
      assert.fail(`thread answered ${answer.kind}${answer.kind === 'failed' ? `: ${answer.reason}` : ''}`);
    }
    assert.deepEqual(
      { ...answer.thread, labels: [...answer.thread.labels], assignees: [...answer.thread.assignees] },
      { title: 'Crash on start', body: 'It stops at once.', state: 'open', labels: [LABEL], assignees: [PERSON], pull: false },
    );
  },
};

const THREAD_READS_A_CLOSED_ISSUE: TrackerReadsCase = {
  id: 'tracker-reads.thread-reads-a-closed-issue',
  title: 'reads a closed issue as closed',
  features: ['tracker.issue-read'],
  run: async ({ port, world }) => {
    const target = await world.file({ title: 'Old crash', body: 'Fixed long ago.', state: 'closed' });
    const answer = await port.thread(target);
    assert.equal(answer.kind === 'read' ? answer.thread.state : answer.kind, 'closed');
  },
};

const THREAD_OF_A_MISSING_ISSUE_IS_MISSING: TrackerReadsCase = {
  id: 'tracker-reads.thread-of-a-missing-issue-is-missing',
  title: 'answers missing for an issue the tracker does not hold',
  features: ['tracker.issue-read'],
  run: async ({ port, world }) => {
    await world.file({ title: 'Crash on start', body: 'It stops at once.' });
    assert.equal((await port.thread({ repo: world.repo, number: 9999 })).kind, 'missing');
  },
};

const SEARCH_FINDS_BY_WORDS: TrackerReadsCase = {
  id: 'tracker-reads.search-finds-by-words',
  title: 'finds the issues whose title or body holds every word, and leaves out the rest',
  features: ['tracker.search'],
  run: async ({ port, world }) => {
    const wanted = await world.file({ title: 'Add a dark theme', body: 'The pane is too bright at night.' });
    await world.file({ title: 'Crash on start', body: 'It stops at once.' });
    const byTitle = found(await port.search.searchIssues(world.repo, query('dark theme')), 'a search by title');
    assert.deepEqual(byTitle, { issues: [{ target: wanted, title: 'Add a dark theme', state: 'open', pull: false }], more: false });
    const byBody = found(await port.search.searchIssues(world.repo, query('bright')), 'a search by body');
    assert.deepEqual(numbers(byBody.issues), [wanted.number]);
  },
};

const SEARCH_KEEPS_TO_THE_STATE: TrackerReadsCase = {
  id: 'tracker-reads.search-keeps-to-the-state',
  title: 'finds only open issues, only closed ones, or both, as it is asked',
  features: ['tracker.search'],
  run: async ({ port, world }) => {
    const open = await world.file({ title: 'Theme crash on start', body: 'It stops.' });
    const closed = await world.file({ title: 'Theme crash on exit', body: 'It hangs.', state: 'closed' });
    const of = async (state: IssueQuery['state']): Promise<readonly number[]> => numbers(found(await port.search.searchIssues(world.repo, query('theme crash', state)), `a search of ${state}`).issues);
    assert.deepEqual(
      { open: await of('open'), closed: await of('closed'), all: await of('all') },
      { open: [open.number], closed: [closed.number], all: [open.number, closed.number].sort((a, b) => a - b) },
    );
  },
};

const SEARCH_OF_PULLS_FINDS_NO_ISSUE: TrackerReadsCase = {
  id: 'tracker-reads.search-of-pulls-finds-no-issue',
  title: 'finds no issue when it is asked for pull requests alone',
  features: ['tracker.search'],
  run: async ({ port, world }) => {
    await world.file({ title: 'Add a dark theme', body: 'The pane is too bright at night.' });
    assert.deepEqual(found(await port.search.searchIssues(world.repo, query('dark theme', 'all', 'pull')), 'a search of pull requests'), { issues: [], more: false });
  },
};

const SEARCH_SAYS_MORE: TrackerReadsCase = {
  id: 'tracker-reads.search-says-more',
  title: `gives at most ${String(SEARCH_PAGE)} issues of a search, and says when the tracker holds more`,
  features: ['tracker.search'],
  run: async ({ port, world }) => {
    for (let at = 1; at <= SEARCH_PAGE + 1; at += 1) {
      await world.file({ title: `Theme idea ${String(at)}`, body: 'One more.' });
    }
    const answer = found(await port.search.searchIssues(world.repo, query('theme idea')), 'a search past one page');
    assert.deepEqual({ given: answer.issues.length, more: answer.more }, { given: SEARCH_PAGE, more: true });
  },
};

/**
 * What every tracker must read of a team's issues, whatever tool holds them. It is a port of its own, apart from the
 * writes' `tracker` contract, so a tracker can bind its writes before its reads. The missing issue and the search of
 * pull requests are its negative tests: a tracker that makes up an answer fails them.
 */
export const TRACKER_READS_CONTRACT: Contract<TrackerReadsPort, TrackerReadsWorld, 'connector'> = defineContract({
  port: 'tracker-reads',
  side: 'connector',
  cases: [
    THREAD_READS_THE_ISSUE,
    THREAD_READS_A_CLOSED_ISSUE,
    THREAD_OF_A_MISSING_ISSUE_IS_MISSING,
    SEARCH_FINDS_BY_WORDS,
    SEARCH_KEEPS_TO_THE_STATE,
    SEARCH_OF_PULLS_FINDS_NO_ISSUE,
    SEARCH_SAYS_MORE,
  ],
  liars: [nothingReads, yesReads],
});
