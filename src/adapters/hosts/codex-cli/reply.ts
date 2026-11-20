/**
 * What a teamrig hook printed, rewritten as the reply Codex CLI 0.170.0 reads for that event.
 *
 * Codex reads a hook's stdout with every unknown key refused, at the top and inside `hookSpecificOutput`, and with
 * every value of the wrong type refused (`codex-rs/hooks/src/engine/output_parser.rs` and the schemas in
 * `codex-rs/hooks/schema/generated/<event>.command.output.schema.json`, tag rust-v0.170.0). A reply it refuses is no
 * reply: on PreToolUse the call then runs. It also takes a reply it can read and still throws the verdict away when
 * the reply asks for something Codex has no hook for there (`ask`, an `allow` with no rewrite, `continue: false` on a
 * tool call), and the call runs again.
 *
 * teamrig's hooks print the reply Claude Code reads, which has keys Codex does not know, so handing it over as it is
 * would switch a guard off without a sign. The reply is therefore built new, from the keys Codex names for the event
 * and only from values of the right type. On a tool call it never fails open: a verdict Codex cannot carry out, and
 * one this module cannot read, becomes a refusal of that call. Every field of teamrig's reply that Codex was not
 * handed is listed in `dropped`, so a caller can refuse where a dropped field was the protection.
 */

import type { SharedHookEvent } from './events.ts';

/** The reply to print for Codex, with the fields of teamrig's own reply that have no effect there. */
export interface CodexReply {
  /** One line of JSON, or the empty text when there is nothing Codex would read. */
  readonly stdout: string;
  /** Dotted paths into teamrig's reply; `(plain text)` stands for a reply that was no JSON object. */
  readonly dropped: readonly string[];
}

type Json = Readonly<Record<string, unknown>>;

const SPECIFIC = 'hookSpecificOutput';
const PLAIN_TEXT = '(plain text)';

/** The events on which Codex hands a hook's plain stdout to the model as context. */
const CONTEXT_EVENTS: readonly SharedHookEvent[] = ['SessionStart', 'SubagentStart', 'UserPromptSubmit'];

const UNEXPLAINED_DENY = 'A teamrig hook refused this call and gave no reason.';
const UNEXPLAINED_BLOCK = 'A teamrig hook blocked this and gave no reason.';
const STOPPED = 'A teamrig hook stopped the session at this call, so the call is refused.';
const ASKED = "A teamrig hook asked for a person's approval, which a Codex hook cannot ask for, so the call is refused.";
const ASKED_NOTE = 'refused: a Codex hook cannot ask a person to approve a call';
const UNKNOWN_VERDICT = "A teamrig hook's verdict on this call is not one Codex knows, so the call is refused.";
const UNREADABLE_REPLY = "A teamrig hook's reply on this call could not be read, so the call is refused.";
const REWRITE_NOT_ALLOWED = 'A teamrig hook rewrote this call without allowing it, so the call is refused.';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One JSON object of teamrig's reply, remembering which of its fields were handed on. A `null` field reads as absent,
 * the way Codex's own parser reads one.
 */
class ReplyPart {
  readonly #fields: Readonly<Record<string, unknown>>;
  readonly #path: string;
  readonly #used = new Set<string>();
  readonly #parts: ReplyPart[] = [];

  constructor(fields: Readonly<Record<string, unknown>>, path: string) {
    this.#fields = fields;
    this.#path = path;
  }

  /** A field's value, not counted as handed on. */
  peek(key: string): unknown {
    const value: unknown = Object.hasOwn(this.#fields, key) ? this.#fields[key] : undefined;
    return value === null ? undefined : value;
  }

  holds(key: string): boolean {
    return this.peek(key) !== undefined;
  }

  /** Counts each field as handed on, or as having nothing left to hand on. */
  use(...keys: readonly string[]): void {
    for (const key of keys) {
      this.#used.add(key);
    }
  }

  /** A field's value of any type, counted as handed on. */
  take(key: string): unknown {
    this.use(key);
    return this.peek(key);
  }

  /** A text field as it is; a field of another type stays unused. */
  text(key: string): string | undefined {
    const value = this.peek(key);
    if (typeof value !== 'string') {
      return undefined;
    }
    this.use(key);
    return value;
  }

  /** A text field trimmed, as Codex trims a reason; a blank one or one of another type stays unused. */
  words(key: string): string | undefined {
    const value = this.peek(key);
    if (typeof value !== 'string' || value.trim() === '') {
      return undefined;
    }
    this.use(key);
    return value.trim();
  }

  /** A true-or-false field; a field of another type stays unused. */
  flag(key: string): boolean | undefined {
    const value = this.peek(key);
    if (typeof value !== 'boolean') {
      return undefined;
    }
    this.use(key);
    return value;
  }

  /** Counts a field holding the value Codex assumes anyway as handed on. */
  useDefault(key: string, value: boolean): void {
    if (this.peek(key) === value) {
      this.use(key);
    }
  }

  /** Whether a field is there and is not a JSON object. */
  holdsNoRecord(key: string): boolean {
    return this.holds(key) && !isRecord(this.peek(key));
  }

  /** A field that is a JSON object, as a part that reports its own unused fields. */
  part(key: string): ReplyPart | undefined {
    const value = this.peek(key);
    if (!isRecord(value)) {
      return undefined;
    }
    this.use(key);
    const part = new ReplyPart(value, `${this.#path}${key}.`);
    this.#parts.push(part);
    return part;
  }

  /** The paths of the fields never handed on, this object's first, then its parts'. */
  unused(): readonly string[] {
    const own = Object.keys(this.#fields)
      .filter((key) => this.holds(key) && !this.#used.has(key))
      .map((key) => `${this.#path}${key}`);
    return [...own, ...this.#parts.flatMap((part) => part.unused())];
  }
}

/** One field of a reply, left out when it has no value. */
function field(key: string, value: unknown): Json {
  return value === undefined ? {} : { [key]: value };
}

/** An event's `hookSpecificOutput`, which Codex refuses without the event's own name; left out when empty. */
function specificOutput(event: SharedHookEvent, fields: Json): Json {
  return Object.keys(fields).length === 0 ? {} : { [SPECIFIC]: { hookEventName: event, ...fields } };
}

function messageOf(reply: ReplyPart): Json {
  return field('systemMessage', reply.text('systemMessage'));
}

/** `continue: false` with its reason. A `stopReason` beside a session that goes on means nothing and stays unused. */
function stopOf(reply: ReplyPart): Json {
  return reply.flag('continue') === false ? { continue: false, ...field('stopReason', reply.words('stopReason')) } : {};
}

/** The keys every event but a tool call takes. */
function universalOf(reply: ReplyPart): Json {
  const quiet = reply.flag('suppressOutput') === true ? { suppressOutput: true } : {};
  return { ...stopOf(reply), ...quiet, ...messageOf(reply) };
}

/** The reason of a `decision: block`, which Codex takes only with one that is not blank. Another decision stays unused. */
function blockReason(reply: ReplyPart): string | undefined {
  if (reply.peek('decision') !== 'block') {
    return undefined;
  }
  const reason = reply.words('reason') ?? UNEXPLAINED_BLOCK;
  reply.use('decision', 'reason');
  return reason;
}

function blockOf(reply: ReplyPart): Json {
  const reason = blockReason(reply);
  return reason === undefined ? {} : { decision: 'block', reason };
}

/** teamrig's `hookSpecificOutput`, when it is a JSON object. Its event name is written anew, so it counts as handed on. */
function specificPart(reply: ReplyPart): ReplyPart | undefined {
  const specific = reply.part(SPECIFIC);
  specific?.use('hookEventName');
  return specific;
}

/** The context for the model, the one field these events' `hookSpecificOutput` takes. */
function contextOf(event: SharedHookEvent, reply: ReplyPart): Json {
  return specificOutput(event, field('additionalContext', specificPart(reply)?.text('additionalContext')));
}

function preToolDeny(reason: string, context?: string): Json {
  return specificOutput('PreToolUse', {
    permissionDecision: 'deny',
    permissionDecisionReason: reason,
    ...field('additionalContext', context),
  });
}

/** Codex writes its own text for a deny with no message. */
function approvalDeny(message: string | undefined): Json {
  return specificOutput('PermissionRequest', { decision: { behavior: 'deny', ...field('message', message) } });
}

/**
 * Why a reply that stops the session refuses the tool call it answers. Codex has no stop at a tool call and reads
 * `continue: false` there as a broken reply, so the call would run. Anything but `true` counts as a stop.
 */
function toolCallStop(reply: ReplyPart): string | undefined {
  if (!reply.holds('continue') || reply.peek('continue') === true) {
    reply.useDefault('continue', true);
    return undefined;
  }
  return reply.words('stopReason') ?? STOPPED;
}

/** Why the `hookSpecificOutput` verdict refuses the call: a deny, an ask, or a word Codex does not know. */
function specificRefusal(specific: ReplyPart | undefined): string | undefined {
  if (specific === undefined || !specific.holds('permissionDecision')) {
    return undefined;
  }
  const verdict = specific.peek('permissionDecision');
  if (verdict === 'allow') {
    return undefined;
  }
  const reason = specific.words('permissionDecisionReason');
  if (verdict === 'deny') {
    return reason ?? UNEXPLAINED_DENY;
  }
  if (verdict === 'ask') {
    return reason === undefined ? ASKED : `${reason} (${ASKED_NOTE})`;
  }
  return UNKNOWN_VERDICT;
}

/** Why the older top-level verdict refuses the call: a block, or a word Codex does not know. */
function legacyRefusal(reply: ReplyPart): string | undefined {
  const verdict = reply.peek('decision');
  if (verdict === undefined || verdict === 'approve') {
    return undefined;
  }
  return verdict === 'block' ? (reply.words('reason') ?? UNEXPLAINED_DENY) : UNKNOWN_VERDICT;
}

/**
 * A rewritten input with no `allow` beside it. Codex reads that as a broken reply and runs the call as the model
 * wrote it, which may be just what the hook rewrote away.
 */
function strayRewrite(specific: ReplyPart | undefined): string | undefined {
  const stray = specific !== undefined && specific.holds('updatedInput') && specific.peek('permissionDecision') !== 'allow';
  return stray ? REWRITE_NOT_ALLOWED : undefined;
}

/** The rewrite Codex applies: an `allow` with the new input. An `allow` alone stays unused, and Codex's own approval decides. */
function rewriteOf(specific: ReplyPart | undefined): Json {
  if (specific === undefined || specific.peek('permissionDecision') !== 'allow' || !specific.holds('updatedInput')) {
    return {};
  }
  specific.use('permissionDecision');
  return {
    permissionDecision: 'allow',
    ...field('permissionDecisionReason', specific.words('permissionDecisionReason')),
    updatedInput: specific.take('updatedInput'),
  };
}

function preToolUse(reply: ReplyPart): Json {
  const specific = specificPart(reply);
  const unreadable = reply.holdsNoRecord(SPECIFIC) ? UNREADABLE_REPLY : undefined;
  const refusal = toolCallStop(reply) ?? unreadable ?? specificRefusal(specific) ?? legacyRefusal(reply) ?? strayRewrite(specific);
  const context = specific?.text('additionalContext');
  reply.useDefault('suppressOutput', false);
  if (refusal === undefined) {
    const answer = { ...rewriteOf(specific), ...field('additionalContext', context) };
    return { ...messageOf(reply), ...specificOutput('PreToolUse', answer) };
  }
  // A refused call leaves nothing of the verdict to hand on: not the other verdict, not the rewrite.
  reply.use('continue', 'stopReason', 'decision', 'reason', SPECIFIC);
  specific?.use('permissionDecision', 'permissionDecisionReason', 'updatedInput');
  return { ...messageOf(reply), ...preToolDeny(refusal, context) };
}

/** An approval Codex can carry out: no rewrite of the input or the permissions, and no interrupt. */
function plainAllow(decision: ReplyPart | undefined): boolean {
  return (
    decision !== undefined &&
    decision.peek('behavior') === 'allow' &&
    !decision.holds('updatedInput') &&
    !decision.holds('updatedPermissions') &&
    decision.peek('interrupt') !== true
  );
}

/** Why an approval reply refuses the call beyond its own deny: a stop, or a part or verdict this module cannot read. */
function approvalRefusal(reply: ReplyPart, specific: ReplyPart | undefined, decision: ReplyPart | undefined): string | undefined {
  const stop = toolCallStop(reply);
  if (stop !== undefined) {
    return stop;
  }
  if (reply.holdsNoRecord(SPECIFIC) || specific?.holdsNoRecord('decision') === true) {
    return UNREADABLE_REPLY;
  }
  const behavior = decision?.peek('behavior');
  return decision !== undefined && behavior !== 'allow' && behavior !== 'deny' ? UNKNOWN_VERDICT : undefined;
}

function permissionRequest(reply: ReplyPart): Json {
  const specific = specificPart(reply);
  const decision = specific?.part('decision');
  const refusal = approvalRefusal(reply, specific, decision);
  reply.useDefault('suppressOutput', false);
  decision?.useDefault('interrupt', false);
  if (refusal === undefined && decision?.peek('behavior') !== 'deny') {
    if (!plainAllow(decision)) {
      return messageOf(reply);
    }
    decision?.use('behavior');
    return { ...messageOf(reply), ...specificOutput('PermissionRequest', { decision: { behavior: 'allow' } }) };
  }
  const message = refusal ?? decision?.words('message');
  reply.use('continue', 'stopReason', SPECIFIC);
  specific?.use('decision');
  decision?.use('behavior', 'message', 'updatedInput', 'updatedPermissions');
  return { ...messageOf(reply), ...approvalDeny(message) };
}

function postToolUse(reply: ReplyPart): Json {
  // Codex reads `suppressOutput: true` here as a broken reply, so it is never sent.
  reply.useDefault('suppressOutput', false);
  return { ...stopOf(reply), ...messageOf(reply), ...blockOf(reply), ...contextOf('PostToolUse', reply) };
}

/**
 * Codex has no `decision` before a compaction: a hook stops one with `continue: false`
 * (`codex-rs/hooks/src/events/compact.rs`), so teamrig's block is written that way.
 */
function preCompact(reply: ReplyPart): Json {
  const reason = blockReason(reply);
  const stop = reason === undefined ? {} : { continue: false, stopReason: reason };
  // A stop the hook wrote itself keeps its own reason.
  return { ...stop, ...universalOf(reply) };
}

const REPLIES: Readonly<Record<SharedHookEvent, (reply: ReplyPart) => Json>> = {
  SessionStart: (reply) => ({ ...universalOf(reply), ...contextOf('SessionStart', reply) }),
  // Codex reads no reply at a session's end.
  SessionEnd: () => ({}),
  UserPromptSubmit: (reply) => ({ ...universalOf(reply), ...blockOf(reply), ...contextOf('UserPromptSubmit', reply) }),
  PreToolUse: preToolUse,
  PermissionRequest: permissionRequest,
  PostToolUse: postToolUse,
  PreCompact: preCompact,
  PostCompact: universalOf,
  SubagentStart: (reply) => ({ ...universalOf(reply), ...contextOf('SubagentStart', reply) }),
  // These two take no `hookSpecificOutput` key at all.
  SubagentStop: (reply) => ({ ...universalOf(reply), ...blockOf(reply) }),
  Stop: (reply) => ({ ...universalOf(reply), ...blockOf(reply) }),
};

function lineOf(reply: Json): string {
  return Object.keys(reply).length === 0 ? '' : JSON.stringify(reply);
}

function parsed(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

/**
 * A reply that is no JSON object. Where Codex reads plain stdout as context it is wrapped as context, since Codex
 * refuses a plain text that starts like JSON. On a tool call a text that starts like JSON is a verdict cut short, and
 * refuses the call. Anywhere else Codex has no use for it.
 */
function plainReply(event: SharedHookEvent, text: string): CodexReply {
  if (CONTEXT_EVENTS.includes(event)) {
    return { stdout: lineOf(specificOutput(event, { additionalContext: text })), dropped: [] };
  }
  const cutShort = text.startsWith('{') || text.startsWith('[');
  if (event === 'PreToolUse' && cutShort) {
    return { stdout: lineOf(preToolDeny(UNREADABLE_REPLY)), dropped: [] };
  }
  if (event === 'PermissionRequest' && cutShort) {
    return { stdout: lineOf(approvalDeny(UNREADABLE_REPLY)), dropped: [] };
  }
  return { stdout: '', dropped: [PLAIN_TEXT] };
}

/** Rewrites what a teamrig hook printed for `event` as the reply Codex 0.170.0 reads. */
export function codexReply(event: SharedHookEvent, stdout: string): CodexReply {
  const text = stdout.trim();
  if (text === '') {
    return { stdout: '', dropped: [] };
  }
  const value = parsed(text);
  if (!isRecord(value)) {
    return plainReply(event, text);
  }
  const reply = new ReplyPart(value, '');
  const rewritten = REPLIES[event](reply);
  return { stdout: lineOf(rewritten), dropped: reply.unused() };
}
