import type { HookReply } from '../ports/host/index.ts';

/**
 * One reply for a set of guards run on the same call in one process (T5553), combined as the host combines the replies
 * of separate hooks: any refusal wins and carries every refusal's reason, else any allow, else none; the text for the
 * model and the human keeps every guard's part, in the set's order. Host-neutral: the host's bridge renders the one
 * reply as it renders any.
 */

/** What one guard of the set answered: its reply (none when it lets the call go), or why it gave none. */
export type GuardAnswer =
  | { readonly guard: string; readonly kind: 'replied'; readonly reply: HookReply | undefined }
  | { readonly guard: string; readonly kind: 'failed'; readonly cause: string };

/** The fix a failed guard's refusal names: the same as the fail-closed runner's for a guard that crashed. */
const FAILED_FIX = 'update the teamrig plugin and restart the session; if that does not clear it, tell your lead.';

/**
 * The refusal standing in for a guard that threw: a guard that cannot answer must not let a call through, so the set
 * refuses, naming it, whatever the other guards said.
 */
export function failedGuardReason(guard: string, cause: string): string {
  return `teamrig blocked this call: its ${guard} guard crashed (${cause}), and a guard that cannot answer must not let a call through. Fix: ${FAILED_FIX}`;
}

/** The reply each answer stands for: a failed guard's is its refusal. */
function replyOf(answer: GuardAnswer): HookReply | undefined {
  return answer.kind === 'replied' ? answer.reply : { verdict: { kind: 'deny', reason: failedGuardReason(answer.guard, answer.cause) } };
}

/** The defined texts joined by `separator`; undefined when there is none. */
function joined(texts: readonly (string | undefined)[], separator: string): string | undefined {
  const present = texts.filter((text): text is string => text !== undefined && text !== '');
  return present.length === 0 ? undefined : present.join(separator);
}

/** The combined verdict: every refusal's reason when any refuses, else every allow's reason when any allows. */
function verdictOf(replies: readonly HookReply[]): HookReply['verdict'] {
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
function firstOf<K extends 'tabTitle' | 'sessionTitle' | 'toolOutput'>(replies: readonly HookReply[], field: K): HookReply[K] {
  return replies.find((reply) => reply[field] !== undefined)?.[field];
}

/** The set's one reply; undefined when every guard let the call go with nothing to say. */
export function combinedGuardReply(answers: readonly GuardAnswer[]): HookReply | undefined {
  const replies = answers.flatMap((answer) => {
    const reply = replyOf(answer);
    return reply === undefined ? [] : [reply];
  });
  if (replies.length === 0) {
    return undefined;
  }
  const parts: HookReply = {
    verdict: verdictOf(replies),
    context: joined(replies.map((reply) => reply.context), '\n\n'),
    notice: joined(replies.map((reply) => reply.notice), '\n'),
    tabTitle: firstOf(replies, 'tabTitle'),
    sessionTitle: firstOf(replies, 'sessionTitle'),
    toolOutput: firstOf(replies, 'toolOutput'),
  };
  return Object.values(parts).every((part) => part === undefined) ? undefined : parts;
}
