import type { CloseReason, HostEnd, IssueTarget } from '../../plugin-api/index.ts';
import type { TrackerPort, TrackerSubject, TrackerWorld, WorldIssue } from './tracker.ts';

/** The writes of the tracker port, each one a reference tracker can be told to answer as done without doing it. */
export const TRACKER_WRITES = ['open', 'comment', 'editBody', 'close', 'addLabels', 'removeLabel', 'assign', 'unassign'] as const;
export type TrackerWrite = (typeof TRACKER_WRITES)[number];

/** How a reference tracker departs from one that does every write honestly. */
export interface TrackerOptions {
  /** The writes it answers as done without doing them. */
  readonly lies?: readonly TrackerWrite[];
  /** Says every label is there, whether the place has it or not. */
  readonly everyLabel?: boolean;
  /** Closes every issue as completed, whatever reason it is given. */
  readonly oneReason?: boolean;
  /** Writes on a target it holds no issue at by filing one there, as a tracker that never reads first would seem to. */
  readonly writesAnywhere?: boolean;
}

interface HeldIssue {
  title: string;
  body: string;
  state: 'open' | 'closed';
  reason: CloseReason | undefined;
  labels: string[];
  assignees: string[];
  readonly comments: string[];
}

const DONE: HostEnd = { kind: 'done' };
const REPO = 'acme/app';

/**
 * A tracker held in memory that does what the contract asks: what the kit's own spec runs the cases against. Its
 * options make it lie, so a spec can show which case catches which lie.
 */
export function referenceTracker(options: TrackerOptions = {}): TrackerSubject {
  const lies = new Set(options.lies ?? []);
  const issues = new Map<number, HeldIssue>();
  const labels = new Set<string>();
  const people = new Set<string>();
  let last = 0;

  const add = (title: string, body: string, given: readonly string[] = []): IssueTarget => {
    last += 1;
    issues.set(last, { title, body, state: 'open', reason: undefined, labels: [...given], assignees: [], comments: [] });
    return { repo: REPO, number: last };
  };
  const issueAt = (target: IssueTarget): HeldIssue | undefined => {
    const held = target.repo === REPO ? issues.get(target.number) : undefined;
    if (held !== undefined || options.writesAnywhere !== true) {
      return held;
    }
    const made: HeldIssue = { title: '', body: '', state: 'open', reason: undefined, labels: [], assignees: [], comments: [] };
    issues.set(target.number, made);
    return made;
  };
  /** Does `act` on the issue at `target`, or answers done without it for a write it lies about. */
  const write = (name: TrackerWrite, target: IssueTarget, act: (issue: HeldIssue) => HostEnd): Promise<HostEnd> => {
    if (lies.has(name)) {
      return Promise.resolve(DONE);
    }
    const issue = issueAt(target);
    return Promise.resolve(issue === undefined ? { kind: 'failed', reason: `no issue at ${target.repo}#${String(target.number)}` } : act(issue));
  };

  const port: TrackerPort = {
    open: (draft) => {
      if (lies.has('open')) {
        last += 1;
        return Promise.resolve({ kind: 'opened', target: { repo: draft.repo, number: last } });
      }
      if (draft.repo !== REPO) {
        return Promise.resolve({ kind: 'failed', reason: `no place ${draft.repo}` });
      }
      return Promise.resolve({ kind: 'opened', target: add(draft.title, draft.body, draft.labels) });
    },
    comment: (target, body) =>
      write('comment', target, (issue) => {
        issue.comments.push(body);
        return DONE;
      }),
    editBody: (target, body) =>
      write('editBody', target, (issue) => {
        issue.body = body;
        return DONE;
      }),
    close: (target, reason) =>
      write('close', target, (issue) => {
        issue.state = 'closed';
        issue.reason = options.oneReason === true ? 'completed' : (reason ?? 'completed');
        return DONE;
      }),
    labelExists: (repo, label) => Promise.resolve(options.everyLabel === true || (repo === REPO && labels.has(label)) ? { kind: 'found' } : { kind: 'missing' }),
    addLabels: (target, given) =>
      write('addLabels', target, (issue) => {
        issue.labels = [...new Set([...issue.labels, ...given])];
        return DONE;
      }),
    removeLabel: (target, label) =>
      write('removeLabel', target, (issue) => {
        issue.labels = issue.labels.filter((each) => each !== label);
        return DONE;
      }),
    assign: (target, logins) =>
      write('assign', target, (issue) => {
        const unknown = logins.filter((login) => !people.has(login));
        if (unknown.length > 0) {
          return { kind: 'failed', reason: `no person ${unknown.join(', ')}` };
        }
        issue.assignees = [...new Set([...issue.assignees, ...logins])];
        return DONE;
      }),
    unassign: (target, login) =>
      write('unassign', target, (issue) => {
        issue.assignees = issue.assignees.filter((each) => each !== login);
        return DONE;
      }),
  };

  const world: TrackerWorld = {
    repo: REPO,
    fileByHand: (title, body) => add(title, body),
    makeLabel: (name) => {
      labels.add(name);
    },
    addPerson: (login) => {
      people.add(login);
    },
    issue: (target): WorldIssue | undefined => {
      const held = target.repo === REPO ? issues.get(target.number) : undefined;
      return held === undefined ? undefined : { ...held, labels: [...held.labels], assignees: [...held.assignees], comments: [...held.comments] };
    },
  };
  return { port, world };
}

/** A liar that answers every write as done and makes none. */
export function yesTracker(): TrackerSubject {
  return referenceTracker({ lies: TRACKER_WRITES, everyLabel: true });
}

/** A liar that claims every feature and can do nothing: each write fails, and no label is there. */
export function nothingTracker(): TrackerSubject {
  const failed: HostEnd = { kind: 'failed', reason: 'nothing here' };
  const fails = (): Promise<HostEnd> => Promise.resolve(failed);
  return {
    world: referenceTracker().world,
    port: {
      open: () => Promise.resolve({ kind: 'failed', reason: 'nothing here' }),
      comment: fails,
      editBody: fails,
      close: fails,
      labelExists: () => Promise.resolve({ kind: 'missing' }),
      addLabels: fails,
      removeLabel: fails,
      assign: fails,
      unassign: fails,
    },
  };
}
