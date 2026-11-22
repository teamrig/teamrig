/**
 * Who answers a wait on a task of `owner`'s: its leaders (`LeadTree.approversOf`) a decision or an approval, and the
 * team's security reviewer (`roles.securityReviewer`) an approval too, which is how the review gate holds a change
 * for it (T828), but never one on its own task. A push to a protected branch still reads only the leaders' approvals
 * (`approvedTaskOf`).
 */
export function waitAnswerersOf(tree, roles, owner) {
    const leaders = tree.approversOf(owner);
    const reviewer = roles.securityReviewer;
    const reviews = reviewer !== undefined && reviewer !== owner && !leaders.includes(reviewer);
    return { decision: leaders, approval: reviews ? [...leaders, reviewer] : leaders };
}
/**
 * The task's answer to `reason` when it is an approval wait its giver answered, either way (`approve`, T684);
 * undefined otherwise. A new status clears the answer with the waits (fold.ts), so an answer covers only the step its
 * task asked about; the approval wait set again keeps it while the note names no other head (T2117, T3044).
 */
export function answerTo(task, reason) {
    return reason.kind === 'approval' && task.answer !== null && task.answer.by === reason.who ? task.answer : undefined;
}
/** Whether the task's answer clears `reason`: an approval wait whose giver approved it. */
export function approvalCleared(task, reason) {
    return answerTo(task, reason)?.verdict === 'approved';
}
const COMMIT_SHA = /^[0-9a-f]{7,40}$/;
const COMMIT_SHA_RUN = /\b[0-9a-f]{7,40}\b/g;
/** Whether `text` is a commit sha, full or abbreviated to at least 7 hex digits. */
export function isCommitSha(text) {
    return COMMIT_SHA.test(text);
}
/**
 * Whether the task's answer note names a sha `head` starts with: an approval covers only the head it names, so an
 * approval of an earlier head never clears a later one (T2788). Shared by the ship tool's merge and `teamrig pr`
 * (T4817).
 */
export function answerNamesHead(task, head) {
    const named = task.answer?.note?.match(COMMIT_SHA_RUN) ?? [];
    return named.some((sha) => head.startsWith(sha));
}
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;
const FULL_COMMIT_SHA_RUN = /\b[0-9a-f]{40}\b/g;
/** Whether `text` is a full 40-hex commit sha. */
export function isFullCommitSha(text) {
    return FULL_COMMIT_SHA.test(text);
}
/**
 * Whether the task's answer note names `head` in full: what `teamrig pr` holds an outside pull request's approval to
 * (T4958 C1). Its author picks the commits, and a commit sharing a 7-hex prefix with the approved head is cheap to
 * grind, so a prefix match could carry the approval over to code no one reviewed.
 */
export function answerNamesFullHead(task, head) {
    const named = task.answer?.note?.match(FULL_COMMIT_SHA_RUN) ?? [];
    return named.includes(head);
}
/**
 * The first task of `owner`'s, in register order, that waits on the approval of one of `approvers` (its leaders,
 * `LeadTree.chainOf`) and has it: what lets `owner` push to a protected branch under `pushGuard.pushToProtected: lead`
 * or `gated`.
 * Undefined when it holds none.
 */
export function approvedTaskOf(tasks, owner, approvers) {
    for (const task of tasks) {
        if (task.owner !== owner || task.status !== 'waiting') {
            continue;
        }
        const reason = task.waits.find((wait) => wait.kind === 'approval' && approvers.includes(wait.who) && approvalCleared(task, wait));
        if (reason !== undefined) {
            return { task, by: reason.who };
        }
    }
    return undefined;
}
