import { isRecord, type PullChecks, type PullStand, type PullState } from '../../../plugin-api/index.ts';
import { rollupChecks } from './pulls.ts';

/** GraphQL's PullRequestState, as `pr approve` and `pr merge` read it, in teamrig's words. */
const STATE_OF: ReadonlyMap<string, PullState> = new Map<string, PullState>([
  ['OPEN', 'open'],
  ['CLOSED', 'closed'],
  ['MERGED', 'merged'],
]);

/** What one answer to gh.ts PULL_STAND_QUERY holds: the pull request, none (GitHub answered null), or no answer of that shape. */
export type PullStandAnswer = { readonly kind: 'read'; readonly pull: PullStand } | { readonly kind: 'missing' } | { readonly kind: 'unreadable' };

/**
 * The pull request an answer to PULL_STAND_QUERY names (T4817): `data.repository` with its default branch, its merge
 * queue (null when the branch has none) and the pull request (null when the access sees none). Any field off its
 * shape makes the answer unreadable, so a landing never acts on half a read. GitHub's `mergeable` is MERGEABLE,
 * CONFLICTING or UNKNOWN while it still works it out; only CONFLICTING counts as conflicts, as GitHub's own gate
 * refuses the rest. `checks` is the head's check rollup, which `pr merge` holds to passing itself, since an admin
 * token may bypass the branch's rules (T4958 C3).
 */
export function pullStandIn(stdout: string): PullStandAnswer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { kind: 'unreadable' };
  }
  const data = isRecord(parsed) ? parsed['data'] : undefined;
  const repository = isRecord(data) ? data['repository'] : undefined;
  if (!isRecord(repository)) {
    return { kind: 'unreadable' };
  }
  const { defaultBranchRef, mergeQueue, pullRequest } = repository;
  const defaultBranch = isRecord(defaultBranchRef) ? defaultBranchRef['name'] : undefined;
  if (typeof defaultBranch !== 'string' || (mergeQueue !== null && !isRecord(mergeQueue))) {
    return { kind: 'unreadable' };
  }
  if (pullRequest === null) {
    return { kind: 'missing' };
  }
  if (!isRecord(pullRequest)) {
    return { kind: 'unreadable' };
  }
  const { id, state, isDraft, headRefOid, baseRefName, mergeable, mergeQueueEntry, commits } = pullRequest;
  const pullState = typeof state === 'string' ? STATE_OF.get(state) : undefined;
  const checks = headChecksOf(commits);
  if (
    typeof id !== 'string' ||
    pullState === undefined ||
    checks === undefined ||
    typeof isDraft !== 'boolean' ||
    typeof headRefOid !== 'string' ||
    typeof baseRefName !== 'string' ||
    typeof mergeable !== 'string' ||
    (mergeQueueEntry !== null && mergeQueueEntry !== undefined && !isRecord(mergeQueueEntry))
  ) {
    return { kind: 'unreadable' };
  }
  return {
    kind: 'read',
    pull: {
      id,
      state: pullState,
      draft: isDraft,
      head: headRefOid,
      base: baseRefName,
      defaultBranch,
      mergeQueue: mergeQueue !== null,
      queued: isRecord(mergeQueueEntry),
      conflicts: mergeable === 'CONFLICTING',
      checks,
    },
  };
}

/**
 * The head's checks from `commits(last:1)`: its statusCheckRollup's state; when GitHub answers the rollup null, its
 * check runs (checkRunsChecks). undefined when the part is off its shape or names a state GitHub does not send.
 */
function headChecksOf(commits: unknown): PullChecks | undefined {
  const nodes = isRecord(commits) ? commits['nodes'] : undefined;
  const last: unknown = Array.isArray(nodes) ? nodes.at(-1) : undefined;
  const commit = isRecord(last) ? last['commit'] : undefined;
  if (!isRecord(commit)) {
    return undefined;
  }
  const rollup = commit['statusCheckRollup'];
  if (rollup === null) {
    return checkRunsChecks(commit['checkSuites']);
  }
  return isRecord(rollup) ? rollupChecks(rollup['state']) : undefined;
}

/** A finished check run's conclusions that pass, as GitHub's own rollup counts them; every other conclusion fails. */
const PASSING_CONCLUSIONS: ReadonlySet<string> = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

/**
 * The head's checks read from its check runs, for a head whose rollup GitHub answers null (T5164): it does so for a
 * commit that also holds a check suite awaiting approval, as release-please's head does beside the ci run started by
 * hand, though that run's checks passed. A run not finished is pending, one finished on any conclusion but
 * PASSING_CONCLUSIONS is failing; none at all is `none`. A suite or run list longer than the query reads (its
 * totalCount above its nodes) is pending, since the runs left unread could fail. undefined when off its shape.
 */
function checkRunsChecks(checkSuites: unknown): PullChecks | undefined {
  const suites = pageOf(checkSuites);
  if (suites === undefined) {
    return undefined;
  }
  let runs = 0;
  let pending = suites.partial;
  for (const suite of suites.nodes) {
    const page = isRecord(suite) ? pageOf(suite['checkRuns']) : undefined;
    if (page === undefined) {
      return undefined;
    }
    pending ||= page.partial;
    for (const run of page.nodes) {
      const check = runCheck(run);
      if (check === undefined || check === 'failing') {
        return check;
      }
      pending ||= check === 'pending';
      runs += 1;
    }
  }
  return pending ? 'pending' : runs === 0 ? 'none' : 'passing';
}

/** A connection's nodes and whether GitHub holds more than it sent (`totalCount` above the nodes); undefined off its shape. */
function pageOf(connection: unknown): { readonly nodes: readonly unknown[]; readonly partial: boolean } | undefined {
  if (!isRecord(connection)) {
    return undefined;
  }
  const { nodes, totalCount } = connection;
  if (!Array.isArray(nodes) || typeof totalCount !== 'number') {
    return undefined;
  }
  return { nodes, partial: totalCount > nodes.length };
}

/** One check run: pending until COMPLETED, then passing or failing by its conclusion; undefined off its shape. */
function runCheck(run: unknown): PullChecks | undefined {
  if (!isRecord(run) || typeof run['status'] !== 'string') {
    return undefined;
  }
  if (run['status'] !== 'COMPLETED') {
    return 'pending';
  }
  const conclusion = run['conclusion'];
  if (typeof conclusion !== 'string') {
    return undefined;
  }
  return PASSING_CONCLUSIONS.has(conclusion) ? 'passing' : 'failing';
}
