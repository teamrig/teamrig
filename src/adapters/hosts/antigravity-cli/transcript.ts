import {
  isRecord,
  stringField,
  type CallUsage,
  type EntryKind,
  type InputEntry,
  type JsonRecord,
  type ReplyCall,
  type ReplyEntry,
  type TranscriptEntry,
  type TranscriptReader,
  type UnreadLine,
} from '../../../plugin-api/index.ts';

/**
 * Antigravity CLI's transcript reader for `transcript_full.jsonl`
 * (`~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript_full.jsonl`).
 *
 * Verified against live `agy 1.5.14` runs: `USER_INPUT`, `PLANNER_RESPONSE` (with `input_tokens`,
 * `cache_read_tokens`, `output_tokens`, and `tool_calls`), and `GENERIC` tool-result lines.
 */

const NOT_BLANK = /\S/;
const DAMAGED: UnreadLine = { kind: 'unread', reason: 'damaged' };
const NOT_AN_OBJECT: UnreadLine = { kind: 'unread', reason: 'not-an-object' };

function nonNegativeFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function usageOf(record: JsonRecord): CallUsage | 'unreadable' | undefined {
  const hasInput = Object.hasOwn(record, 'input_tokens');
  const hasOutput = Object.hasOwn(record, 'output_tokens');
  const hasCache = Object.hasOwn(record, 'cache_read_tokens');
  if (!hasInput && !hasOutput && !hasCache) {
    return undefined;
  }
  const input = nonNegativeFinite(record['input_tokens']);
  const output = nonNegativeFinite(record['output_tokens']);
  const cacheRead = hasCache ? nonNegativeFinite(record['cache_read_tokens']) : 0;
  if (input === undefined || output === undefined || cacheRead === undefined) {
    return 'unreadable';
  }
  return { input, cacheWrite5m: 0, cacheWrite1h: 0, cacheWriteUnsplit: 0, cacheRead, output };
}

function callsOf(record: JsonRecord, stepId: string | undefined): readonly ReplyCall[] {
  const raw = record['tool_calls'];
  if (!Array.isArray(raw)) {
    return [];
  }
  const calls: ReplyCall[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    if (!isRecord(item)) continue;
    const name = stringField(item, 'name');
    if (name === undefined || name === '') continue;
    const args = item['args'];
    calls.push({
      id: `${stepId ?? 'step'}:${index}`,
      name,
      input: isRecord(args) ? args : undefined,
    });
  }
  return calls;
}

function epochOf(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inputEntry(
  base: Pick<InputEntry, 'at' | 'id' | 'parent' | 'session' | 'thread' | 'meta' | 'job'>,
  record: JsonRecord,
  fromTool: boolean,
): InputEntry {
  const origin = !fromTool && record['source'] === 'USER_EXPLICIT' ? 'person' : undefined;
  return {
    ...base,
    kind: 'input',
    text: stringField(record, 'content'),
    parts: [],
    results: [],
    origin,
    turnOrigin: origin,
    continuation: false,
    fromTool,
    background: undefined,
  };
}

function replyEntry(
  base: Pick<ReplyEntry, 'at' | 'id' | 'parent' | 'session' | 'thread' | 'meta' | 'job'>,
  record: JsonRecord,
): ReplyEntry {
  const content = stringField(record, 'content');
  const status = stringField(record, 'status');
  return {
    ...base,
    kind: 'reply',
    key: base.id,
    model: stringField(record, 'model'),
    effort: undefined,
    usage: usageOf(record),
    texts: content === undefined ? [] : [content],
    calls: callsOf(record, base.id),
    synthetic: false,
    failed: status === 'ERROR' || status === 'FAILED',
    error: stringField(record, 'error'),
  };
}

function entryOf(record: JsonRecord): TranscriptEntry {
  const stepIndex = record['step_index'];
  const id = typeof stepIndex === 'number' && Number.isFinite(stepIndex) ? String(stepIndex) : undefined;
  const base = {
    at: epochOf(record['created_at']),
    id,
    parent: undefined,
    session: undefined,
    thread: undefined,
    meta: false,
    job: undefined,
  };
  const type = stringField(record, 'type');
  if (type === 'USER_INPUT') {
    return inputEntry(base, record, false);
  }
  if (type === 'GENERIC') {
    return inputEntry(base, record, true);
  }
  if (type === 'PLANNER_RESPONSE') {
    return replyEntry(base, record);
  }
  return { ...base, kind: 'other', type };
}

function entryOfLine(line: string): TranscriptEntry | UnreadLine {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return DAMAGED;
  }
  return isRecord(value) ? entryOf(value) : NOT_AN_OBJECT;
}

/** Antigravity CLI's transcript lines as teamrig's entries. */
export const antigravityTranscriptReader: TranscriptReader = {
  entry(line: string, only?: readonly EntryKind[]) {
    if (!NOT_BLANK.test(line)) {
      return undefined;
    }
    const found = entryOfLine(line);
    return found.kind === 'unread' || only === undefined || only.includes(found.kind) ? found : undefined;
  },
  lastPlanSlug: () => undefined,
};
