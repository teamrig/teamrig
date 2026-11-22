import { isRecord, type PullStand, type PullState } from '../../../plugin-api/index.ts';

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
 * refuses the rest.
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
  const { id, state, isDraft, headRefOid, baseRefName, mergeable, mergeQueueEntry } = pullRequest;
  const pullState = typeof state === 'string' ? STATE_OF.get(state) : undefined;
  if (
    typeof id !== 'string' ||
    pullState === undefined ||
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
    },
  };
}
