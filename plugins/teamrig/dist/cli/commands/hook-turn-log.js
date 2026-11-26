import { SecretScanner } from "../../core/secrets.js";
import { LastTypedStore } from "../../sessions/last-typed.js";
import { cappedText } from "../../turn-log/entry.js";
import { REPLY_TAIL_BYTES, replyOf } from "../../turn-log/reply.js";
import { TurnLog } from "../../turn-log/store.js";
import { WakePrompts } from "../../wake/prompts.js";
import { transcriptsIfKept } from "../host.js";
/** What a session start's `source` logs: a /clear or a compaction, which wipe what the tab showed. */
const WIPES = { clear: 'context cleared (/clear)', compact: 'context compacted' };
function entryOf(runtime, scope, said) {
    const { text, cut } = cappedText(new SecretScanner(scope.config.register.secretPatterns).redact(said.text));
    return {
        at: new Date(runtime.clock.now()).toISOString(),
        kind: said.kind,
        text,
        claude: said.claude,
        ...(cut || said.cut === true ? { truncated: true } : {}),
        ...(said.upTo === undefined ? {} : { upTo: said.upTo }),
        ...(said.from === undefined ? {} : { from: said.from }),
    };
}
function logOf(runtime, scope) {
    return new TurnLog(runtime.files, scope.paths.turnLog);
}
/**
 * The prompt of a UserPromptSubmit, told the person's from teamrig's: the wake teamrig answered that tab with is taken
 * once, so the same text typed again is the person's. Undefined for no tab or an empty prompt.
 */
export async function sentPromptOf(runtime, wake, id, { session, prompt, hostPrompt }) {
    if (session === undefined || prompt === undefined || prompt.trim() === '') {
        return undefined;
    }
    // The host's own prompt is never teamrig's wake, so it leaves the kept wake for the prompt that is.
    const woke = !hostPrompt && (await new WakePrompts(runtime.files, wake).take(id, { tab: session, text: prompt }));
    return { tab: session, text: prompt, woke, byHost: hostPrompt };
}
/** UserPromptSubmit: the prompt the person sent, or the wake teamrig submitted in that tab, marked `from: teamrig`; nothing with the log off. */
export async function logPrompt(runtime, scope, sent) {
    if (!scope.config.turnLog.enabled) {
        return;
    }
    const said = { kind: 'prompt', claude: sent.tab, text: sent.text, ...(sent.woke ? { from: 'teamrig' } : {}) };
    await logOf(runtime, scope).append(scope.id, entryOf(runtime, scope, said));
}
/**
 * UserPromptSubmit: a prompt the person typed marks its session the one they last typed in, for a UI to follow (T5101);
 * one teamrig or the host submitted does not (T5388).
 */
export async function noteLastTyped(runtime, paths, id, sent) {
    if (sent.woke || sent.byHost) {
        return;
    }
    const at = new Date(runtime.clock.now()).toISOString();
    await new LastTypedStore(runtime.files, paths.kitHome).write({ team: paths.team, session: id, tab: sent.tab, at });
}
/**
 * The turn's reply from the transcript, ending with the last reply the turn end's hook event names when the
 * transcript does not hold it yet; undefined when the turn wrote no text.
 * A reply of that message alone keeps `after`, the last entry an earlier reply took.
 */
function replyWithLast(reply, last, after) {
    const base = reply === undefined ? undefined : { text: reply.text, cut: reply.cut, upTo: reply.upTo };
    const message = last?.trim();
    if (message === undefined || message === '' || base?.text.trimEnd().endsWith(message) === true) {
        return base;
    }
    return base === undefined ? { text: message, cut: false, upTo: after } : { ...base, text: `${base.text}\n\n${message}` };
}
/**
 * A turn's end: the reply the person saw since the last one logged. A stop that a hook sent back ends part of
 * a turn, so a later stop of the same turn starts after the last entry this one took (`upTo`). On a host whose
 * transcript teamrig cannot read, the reply is the last reply the event names alone.
 */
export async function logReply(runtime, scope, { session: claude, transcript, lastReply }) {
    if (!scope.config.turnLog.enabled || claude === undefined) {
        return;
    }
    const log = logOf(runtime, scope);
    const last = await log.last(scope.id);
    const after = last?.kind === 'reply' && last.claude === claude ? last.upTo : undefined;
    const reader = transcriptsIfKept(runtime);
    const tail = reader === undefined || transcript === undefined ? undefined : await runtime.files.readTail(transcript, REPLY_TAIL_BYTES);
    const fromTranscript = reader === undefined || tail === undefined ? undefined : replyOf(reader, tail, after, Buffer.byteLength(tail, 'utf8') < REPLY_TAIL_BYTES);
    const reply = replyWithLast(fromTranscript, lastReply, after);
    if (reply === undefined) {
        return;
    }
    const { text, cut, upTo } = reply;
    await log.append(scope.id, entryOf(runtime, scope, { kind: 'reply', claude, text, cut, ...(upTo === undefined ? {} : { upTo }) }));
}
/**
 * SessionStart: marks a /clear or a compaction, which wipe what the tab showed, and removes every session's
 * hours past `turnLog.keepHours` (folder listings only).
 */
export async function logStart(runtime, scope, { session, source }) {
    if (!scope.config.turnLog.enabled) {
        return;
    }
    const log = logOf(runtime, scope);
    const wipe = source === undefined ? undefined : WIPES[source];
    if (session !== undefined && wipe !== undefined) {
        await log.append(scope.id, entryOf(runtime, scope, { kind: 'clear', claude: session, text: wipe }));
    }
    await log.prune(runtime.clock.now(), scope.config.turnLog.keepHours);
}
