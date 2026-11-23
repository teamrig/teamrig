/**
 * The input Codex CLI hands a command hook, checked against the shape Codex 0.170.0 publishes for its event.
 *
 * Codex writes one JSON object to a hook's stdin. Its fields per event come from Codex's own JSON schemas
 * (`codex-rs/hooks/schema/generated/<event>.command.input.schema.json`, tag rust-v0.170.0), copied into the table
 * below. A hook that acts on an input it misread could pass a call it should refuse, so an input missing a field its
 * event must carry, or carrying one of the wrong type, is refused with a reason. A field the schema does not name is
 * reported and not refused: a newer Codex may add one, and what to do about it is the caller's call.
 */

import { isSharedHookEvent, type SharedHookEvent } from './events.ts';

/** An input that fits its event's shape, with the fields 0.170.0 does not name, or why it does not fit. */
export type HookInputCheck =
  | { readonly ok: true; readonly event: SharedHookEvent; readonly unknownKeys: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/** What a field holds: a type, any JSON value at all, or one of a list of words. */
type FieldKind = 'string' | 'string or null' | 'boolean' | 'any value' | readonly string[];

type Fields = Readonly<Record<string, FieldKind>>;

interface InputShape {
  readonly required: Fields;
  readonly optional: Fields;
}

const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'] as const;

const SESSION: Fields = { session_id: 'string', cwd: 'string', transcript_path: 'string or null' };
const TURN: Fields = { ...SESSION, model: 'string', turn_id: 'string' };
const PERMITTED_TURN: Fields = { ...TURN, permission_mode: PERMISSION_MODES };
/** A helper's own hooks carry who it is; the main thread's carry neither field. */
const HELPER: Fields = { agent_id: 'string', agent_type: 'string' };
const TOOL_CALL: Fields = { ...PERMITTED_TURN, tool_name: 'string', tool_input: 'any value' };
const COMPACTION: Fields = { ...TURN, trigger: ['manual', 'auto'] };
const TURN_END: Fields = { ...PERMITTED_TURN, last_assistant_message: 'string or null', stop_hook_active: 'boolean' };

const SHAPES: Readonly<Record<SharedHookEvent, InputShape>> = {
  SessionStart: {
    required: { ...SESSION, model: 'string', permission_mode: PERMISSION_MODES, source: ['startup', 'resume', 'clear', 'compact', 'fork'] },
    optional: {},
  },
  SessionEnd: { required: { ...SESSION, reason: ['other'] }, optional: {} },
  UserPromptSubmit: { required: { ...PERMITTED_TURN, prompt: 'string' }, optional: HELPER },
  PreToolUse: { required: { ...TOOL_CALL, tool_use_id: 'string' }, optional: HELPER },
  PermissionRequest: { required: TOOL_CALL, optional: HELPER },
  PostToolUse: { required: { ...TOOL_CALL, tool_use_id: 'string', tool_response: 'any value' }, optional: HELPER },
  PreCompact: { required: COMPACTION, optional: HELPER },
  PostCompact: { required: COMPACTION, optional: HELPER },
  SubagentStart: { required: { ...PERMITTED_TURN, ...HELPER }, optional: {} },
  SubagentStop: { required: { ...TURN_END, ...HELPER, agent_transcript_path: 'string or null' }, optional: {} },
  Stop: { required: TURN_END, optional: {} },
};

const EVENT_KEY = 'hook_event_name';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fits(value: unknown, kind: FieldKind): boolean {
  switch (kind) {
    case 'any value':
      return true;
    case 'string':
      return typeof value === 'string';
    case 'string or null':
      return typeof value === 'string' || value === null;
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return typeof value === 'string' && kind.includes(value);
  }
}

function labelOf(kind: FieldKind): string {
  return typeof kind === 'string' ? `a ${kind}` : `one of ${kind.join(', ')}`;
}

function refuse(reason: string): HookInputCheck {
  return { ok: false, reason };
}

/** The first field of `fields` the input lacks (when it must be there) or holds with the wrong type. */
function faultIn(input: Readonly<Record<string, unknown>>, fields: Fields, required: boolean): string | undefined {
  for (const [key, kind] of Object.entries(fields)) {
    if (!Object.hasOwn(input, key)) {
      if (required) {
        return `has no ${key}`;
      }
      continue;
    }
    if (!fits(input[key], kind)) {
      return `holds a ${key} that is not ${labelOf(kind)}`;
    }
  }
  return undefined;
}

/** Checks a hook's parsed stdin against its event's shape in Codex 0.170.0. */
export function checkHookInput(payload: unknown): HookInputCheck {
  if (!isRecord(payload)) {
    return refuse('the hook input is not a JSON object');
  }
  const name = payload[EVENT_KEY];
  if (typeof name !== 'string') {
    return refuse(`the hook input has no ${EVENT_KEY}`);
  }
  if (!isSharedHookEvent(name)) {
    return refuse(`the hook input is for ${name}, an event teamrig has no hook for on Codex`);
  }
  const shape = SHAPES[name];
  const fault = faultIn(payload, shape.required, true) ?? faultIn(payload, shape.optional, false);
  if (fault !== undefined) {
    return refuse(`the ${name} hook input ${fault}`);
  }
  const named = new Set([EVENT_KEY, ...Object.keys(shape.required), ...Object.keys(shape.optional)]);
  return { ok: true, event: name, unknownKeys: Object.keys(payload).filter((key) => !named.has(key)) };
}
