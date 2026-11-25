import {
  HOOK_EVENTS,
  isRecord,
  recordField,
  stringField,
  type HookBridge,
  type HookEvent,
  type HookEventName,
  type HookHelper,
  type HookReply,
  type HookVerdict,
  type JsonRecord,
  type ToolCall,
  type ToolCallShape,
} from '../../../plugin-api/index.ts';
import type { SharedHookEvent } from './events.ts';

/**
 * Codex CLI's name for each moment teamrig knows and Codex 0.170.0 fires (`codex-rs/protocol/src/hooks.rs`). The four
 * it lacks (a failed tool call, a failed stop, a form and its answer) are never called, so they map to nothing.
 */
const HOST_NAMES: Readonly<Partial<Record<HookEventName, SharedHookEvent>>> = {
  'session-start': 'SessionStart',
  'session-end': 'SessionEnd',
  prompt: 'UserPromptSubmit',
  'tool-start': 'PreToolUse',
  'permission-prompt': 'PermissionRequest',
  'tool-end': 'PostToolUse',
  stop: 'Stop',
  'helper-start': 'SubagentStart',
  'helper-stop': 'SubagentStop',
  'compact-start': 'PreCompact',
  'compact-end': 'PostCompact',
};

/** teamrig's name for a Codex event; undefined for one teamrig has no name for. */
function eventNameOf(hostName: string | undefined): HookEventName | undefined {
  return HOOK_EVENTS.find((name) => HOST_NAMES[name] !== undefined && HOST_NAMES[name] === hostName);
}

/**
 * A Codex session id, as hook stdin carries it: a thread id, which wraps a UUID and prints it in its hyphenated
 * lower-case form (`codex-rs/protocol/src/thread_id.rs`, tag rust-v0.170.0). Any other text is no session.
 */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The events whose reply Codex reads a top-level `decision: "block"` from (`hooks_src_engine_output_parser.rs`). */
const BLOCKED_AT_TOP: ReadonlySet<HookEventName> = new Set<HookEventName>(['prompt', 'tool-end', 'stop', 'helper-stop']);

/** The events whose `hookSpecificOutput` takes `additionalContext` for the model. */
const TAKES_CONTEXT: ReadonlySet<HookEventName> = new Set<HookEventName>(['session-start', 'prompt', 'tool-start', 'tool-end', 'helper-start']);

/** Codex refuses a blank reason, and a refusal with no reason would then not refuse. */
const UNEXPLAINED = 'A teamrig hook refused this and gave no reason.';

function sessionOf(payload: JsonRecord): string | undefined {
  const id = stringField(payload, 'session_id');
  return id !== undefined && SESSION_ID.test(id) ? id : undefined;
}

/** A helper's own hooks carry who it is; a helper's stop also carries its transcript. The main thread's carry none. */
function helperOf(payload: JsonRecord): HookHelper | undefined {
  const helper = { id: stringField(payload, 'agent_id'), type: stringField(payload, 'agent_type'), transcript: stringField(payload, 'agent_transcript_path') };
  return helper.id === undefined && helper.type === undefined && helper.transcript === undefined ? undefined : helper;
}

/** Codex takes no replacement of a tool's answer (its PostToolUse output names no such field), so no call is `replaceable`. */
function callOf(payload: JsonRecord, shape: ToolCallShape): ToolCall | undefined {
  const tool = stringField(payload, 'tool_name');
  if (tool === undefined) {
    return undefined;
  }
  const id = stringField(payload, 'tool_use_id');
  return {
    ...shape.normalize(tool, recordField(payload, 'tool_input') ?? {}),
    ...(id === undefined ? {} : { id }),
    ...(Object.hasOwn(payload, 'tool_response') ? { response: payload['tool_response'] } : {}),
  };
}

/**
 * Every field is read whatever its type, a wrong type reading as absent, rather than the whole input refused for it:
 * a guard that still sees the tool call can refuse it, and one handed no event at all would let it run.
 */
function eventOf(payload: JsonRecord, shape: ToolCallShape): HookEvent {
  const hostName = stringField(payload, 'hook_event_name');
  return {
    name: eventNameOf(hostName) ?? 'other',
    hostName,
    session: sessionOf(payload),
    cwd: stringField(payload, 'cwd'),
    transcript: stringField(payload, 'transcript_path'),
    // Codex hands a hook no session title, effort, notice text or error.
    title: undefined,
    helper: helperOf(payload),
    call: callOf(payload, shape),
    prompt: stringField(payload, 'prompt'),
    // No prompt Codex CLI submits of its own is known to reach the prompt hook.
    hostPrompt: false,
    lastReply: stringField(payload, 'last_assistant_message'),
    stopActive: payload['stop_hook_active'] === true,
    source: stringField(payload, 'source'),
    reason: stringField(payload, 'reason'),
    trigger: stringField(payload, 'trigger'),
    model: stringField(payload, 'model'),
    effort: undefined,
    message: undefined,
    error: undefined,
  };
}

function parsed(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function reasonOf(verdict: Exclude<HookVerdict, { readonly kind: 'allow' }>): string {
  const reason = verdict.reason.trim();
  return reason === '' ? UNEXPLAINED : reason;
}

/** The refusal in a verdict, or undefined for an allow and for no verdict. */
function refusalOf(verdict: HookVerdict | undefined): string | undefined {
  return verdict === undefined || verdict.kind === 'allow' ? undefined : reasonOf(verdict);
}

/**
 * A verdict on a tool call, where Codex reads it. Before the call Codex has no plain allow: it reads one as a broken
 * reply, so an allow is left to Codex's own approval. On the approval prompt an allow is plain, with no rewrite.
 */
function permissionOf(on: HookEventName, verdict: HookVerdict | undefined): JsonRecord {
  const refusal = refusalOf(verdict);
  if (on === 'tool-start') {
    return refusal === undefined ? {} : { permissionDecision: 'deny', permissionDecisionReason: refusal };
  }
  if (on === 'permission-prompt' && verdict !== undefined) {
    return { decision: refusal === undefined ? { behavior: 'allow' } : { behavior: 'deny', message: refusal } };
  }
  return {};
}

function specificOf(on: HookEventName, reply: HookReply): JsonRecord {
  return {
    ...permissionOf(on, reply.verdict),
    ...(TAKES_CONTEXT.has(on) && reply.context !== undefined ? { additionalContext: reply.context } : {}),
  };
}

/**
 * The top-level fields: a block where the event takes one, the human's notice. Codex has no `decision` before a
 * compaction; a hook stops one with `continue: false` (`hooks_src_events_compact.rs`).
 */
function topOf(on: HookEventName, reply: HookReply): JsonRecord {
  const refusal = refusalOf(reply.verdict);
  return {
    ...(refusal !== undefined && on === 'compact-start' ? { continue: false, stopReason: refusal } : {}),
    ...(refusal !== undefined && BLOCKED_AT_TOP.has(on) ? { decision: 'block', reason: refusal } : {}),
    ...(reply.notice === undefined ? {} : { systemMessage: reply.notice }),
  };
}

/**
 * The reply as the one line of JSON Codex reads, with only the keys Codex 0.170.0 names for the event: it refuses a
 * reply holding any other key, and a refused reply on a tool call lets the call run. A session's end takes no reply,
 * and a tab title, a session title and a replaced tool answer have no field in Codex, so they are dropped.
 */
function replyText(on: HookEventName, reply: HookReply): string {
  const hostName = HOST_NAMES[on];
  if (hostName === undefined || on === 'session-end') {
    return '';
  }
  const top = topOf(on, reply);
  const specific = specificOf(on, reply);
  const output = Object.keys(specific).length === 0 ? top : { ...top, hookSpecificOutput: { hookEventName: hostName, ...specific } };
  return Object.keys(output).length === 0 ? '' : JSON.stringify(output);
}

/**
 * The hook port of Codex CLI: its hook input read into the event the core knows, and the core's reply written as the
 * JSON Codex reads on a hook's standard output.
 */
export function hookBridge(shape: ToolCallShape): HookBridge {
  return {
    parse: (raw) => {
      const payload = parsed(raw);
      return isRecord(payload) ? eventOf(payload, shape) : undefined;
    },
    reply: replyText,
    // Codex CLI turns its own tab title off by a config key (`tui.terminal_title`, `config_src_types.rs`), not an
    // environment switch, and its hook output has no title field, so there is no switch to name here.
    titleSwitch: undefined,
  };
}
