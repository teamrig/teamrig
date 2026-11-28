import { SEARCH_PAGE, type FoundIssue, type HostSearch, type HostThread, type IssueQuery, type IssueState, type IssueTarget } from '../../plugin-api/index.ts';
import type { Filing, TrackerReadsSubject, TrackerReadsWorld } from './reads.ts';

/** The ways a reference tracker's reads can be told to lie, each one a mistake a real adapter could make. */
export const READS_LIES = ['staleState', 'dropsLabels', 'missingAsRead', 'ignoresWords', 'ignoresState', 'ignoresKind', 'noMore'] as const;
export type ReadsLie = (typeof READS_LIES)[number];

/** How a reference tracker's reads depart from honest ones. */
export interface ReadsOptions {
  /**
   * staleState: reads every issue as open. dropsLabels: reads no label. missingAsRead: reads an empty issue where it
   * holds none. ignoresWords: finds every issue, whatever the words. ignoresState: finds issues of every state.
   * ignoresKind: finds issues when asked for pull requests. noMore: never says the tracker holds more.
   */
  readonly lies?: readonly ReadsLie[];
}

interface HeldIssue {
  readonly title: string;
  readonly body: string;
  readonly state: IssueState;
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
}

const REPO = 'acme/app';

function holdsEvery(issue: HeldIssue, words: string): boolean {
  const text = `${issue.title}\n${issue.body}`.toLowerCase();
  return words
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')
    .every((word) => text.includes(word));
}

/**
 * A tracker's reads held in memory, doing what the contract asks: what the kit's own spec runs the cases against.
 * Its lies make it wrong one way at a time, so a spec can show which case catches which.
 */
export function referenceReads(options: ReadsOptions = {}): TrackerReadsSubject {
  const lies = new Set(options.lies ?? []);
  const issues = new Map<number, HeldIssue>();

  const thread = (target: IssueTarget): Promise<HostThread> => {
    const held = target.repo === REPO ? issues.get(target.number) : undefined;
    if (held === undefined) {
      return Promise.resolve(
        lies.has('missingAsRead') ? { kind: 'read', thread: { title: '', body: '', state: 'open', labels: [], assignees: [], pull: false } } : { kind: 'missing' },
      );
    }
    return Promise.resolve({
      kind: 'read',
      thread: {
        title: held.title,
        body: held.body,
        state: lies.has('staleState') ? 'open' : held.state,
        labels: lies.has('dropsLabels') ? [] : [...held.labels],
        assignees: [...held.assignees],
        pull: false,
      },
    });
  };

  const searchIssues = (repo: string, query: IssueQuery): Promise<HostSearch> => {
    if (repo !== REPO) {
      return Promise.resolve({ kind: 'failed', reason: `no place ${repo}` });
    }
    if (query.kind === 'pull' && !lies.has('ignoresKind')) {
      return Promise.resolve({ kind: 'found', issues: [], more: false });
    }
    const matches: FoundIssue[] = [...issues]
      .filter(([, issue]) => lies.has('ignoresWords') || holdsEvery(issue, query.words))
      .filter(([, issue]) => lies.has('ignoresState') || query.state === 'all' || issue.state === query.state)
      .map(([number, issue]) => ({ target: { repo: REPO, number }, title: issue.title, state: issue.state, pull: false }));
    return Promise.resolve({ kind: 'found', issues: matches.slice(0, SEARCH_PAGE), more: !lies.has('noMore') && matches.length > SEARCH_PAGE });
  };

  let last = 0;
  const world: TrackerReadsWorld = {
    repo: REPO,
    file: (filing: Filing) => {
      last += 1;
      issues.set(last, { title: filing.title, body: filing.body, state: filing.state ?? 'open', labels: filing.labels ?? [], assignees: filing.assignees ?? [] });
      return { repo: REPO, number: last };
    },
  };
  return { port: { thread, search: { searchIssues } }, world };
}

/** A liar that makes every mistake of the reads at once. */
export function yesReads(): TrackerReadsSubject {
  return referenceReads({ lies: READS_LIES });
}

/** A liar that claims every read and can do none: it holds no issue and finds nothing. */
export function nothingReads(): TrackerReadsSubject {
  return {
    world: referenceReads().world,
    port: {
      thread: () => Promise.resolve({ kind: 'missing' }),
      search: { searchIssues: () => Promise.resolve({ kind: 'found', issues: [], more: false }) },
    },
  };
}
