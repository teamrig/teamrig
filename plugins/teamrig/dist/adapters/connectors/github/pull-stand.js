import { isRecord } from "../../../plugin-api/index.js";
import { rollupChecks } from "./pulls.js";
/** GraphQL's PullRequestState, as `pr approve` and `pr merge` read it, in teamrig's words. */
const STATE_OF = new Map([
    ['OPEN', 'open'],
    ['CLOSED', 'closed'],
    ['MERGED', 'merged'],
]);
/**
 * The pull request an answer to PULL_STAND_QUERY names (T4817): `data.repository` with its default branch, its merge
 * queue (null when the branch has none) and the pull request (null when the access sees none). Any field off its
 * shape makes the answer unreadable, so a landing never acts on half a read. GitHub's `mergeable` is MERGEABLE,
 * CONFLICTING or UNKNOWN while it still works it out; only CONFLICTING counts as conflicts, as GitHub's own gate
 * refuses the rest. `checks` is the head's check rollup, which `pr merge` holds to passing itself, since an admin
 * token may bypass the branch's rules (T4958 C3).
 */
export function pullStandIn(stdout) {
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
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
    if (typeof id !== 'string' ||
        pullState === undefined ||
        checks === undefined ||
        typeof isDraft !== 'boolean' ||
        typeof headRefOid !== 'string' ||
        typeof baseRefName !== 'string' ||
        typeof mergeable !== 'string' ||
        (mergeQueueEntry !== null && mergeQueueEntry !== undefined && !isRecord(mergeQueueEntry))) {
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
 * The head's checks from `commits(last:1)`: its statusCheckRollup's state, `none` when GitHub answers the rollup null
 * (the head has no checks); undefined when the part is off its shape or names a state GitHub does not send.
 */
function headChecksOf(commits) {
    const nodes = isRecord(commits) ? commits['nodes'] : undefined;
    const last = Array.isArray(nodes) ? nodes.at(-1) : undefined;
    const commit = isRecord(last) ? last['commit'] : undefined;
    if (!isRecord(commit)) {
        return undefined;
    }
    const rollup = commit['statusCheckRollup'];
    if (rollup === null) {
        return 'none';
    }
    return isRecord(rollup) ? rollupChecks(rollup['state']) : undefined;
}
