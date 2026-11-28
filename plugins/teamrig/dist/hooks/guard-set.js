/** The fix a failed guard's refusal names: the same as the fail-closed runner's for a guard that crashed. */
const FAILED_FIX = 'update the teamrig plugin and restart the session; if that does not clear it, tell your lead.';
/**
 * The refusal standing in for a guard that threw: a guard that cannot answer must not let a call through, so the set
 * refuses, naming it, whatever the other guards said.
 */
export function failedGuardReason(guard, cause) {
    return `teamrig blocked this call: its ${guard} guard crashed (${cause}), and a guard that cannot answer must not let a call through. Fix: ${FAILED_FIX}`;
}
/** The reply each answer stands for: a failed guard's is its refusal. */
function replyOf(answer) {
    return answer.kind === 'replied' ? answer.reply : { verdict: { kind: 'deny', reason: failedGuardReason(answer.guard, answer.cause) } };
}
/** The defined texts joined by `separator`; undefined when there is none. */
function joined(texts, separator) {
    const present = texts.filter((text) => text !== undefined && text !== '');
    return present.length === 0 ? undefined : present.join(separator);
}
/** The combined verdict: every refusal's reason when any refuses, else every allow's reason when any allows. */
function verdictOf(replies) {
    const verdicts = replies.flatMap(({ verdict }) => (verdict === undefined ? [] : [verdict]));
    const refusals = verdicts.flatMap((verdict) => (verdict.kind === 'allow' ? [] : [verdict.reason]));
    if (refusals.length > 0) {
        return { kind: 'deny', reason: refusals.join('\n') };
    }
    if (verdicts.length === 0) {
        return undefined;
    }
    return { kind: 'allow', reason: joined(verdicts.map((verdict) => verdict.reason), '\n') };
}
/** The first of the set's replies that sets `field`, for the parts only one reply can hold. */
function firstOf(replies, field) {
    return replies.find((reply) => reply[field] !== undefined)?.[field];
}
/** The set's one reply; undefined when every guard let the call go with nothing to say. */
export function combinedGuardReply(answers) {
    return combinedReply(answers.map(replyOf));
}
/**
 * The one reply for the replies of hooks run on the same call, in their order, as the host combines separate hooks'
 * (a missing reply is a hook with nothing to say); undefined when none says anything. `hook after` (T5821) combines
 * its PostToolUse members' with it too.
 */
export function combinedReply(answered) {
    const replies = answered.flatMap((reply) => (reply === undefined ? [] : [reply]));
    if (replies.length === 0) {
        return undefined;
    }
    const parts = {
        verdict: verdictOf(replies),
        context: joined(replies.map((reply) => reply.context), '\n\n'),
        notice: joined(replies.map((reply) => reply.notice), '\n'),
        tabTitle: firstOf(replies, 'tabTitle'),
        sessionTitle: firstOf(replies, 'sessionTitle'),
        toolOutput: firstOf(replies, 'toolOutput'),
    };
    return Object.values(parts).every((part) => part === undefined) ? undefined : parts;
}
