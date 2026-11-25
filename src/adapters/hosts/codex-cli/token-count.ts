/**
 * The `token_count` events of a Codex CLI rollout (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`), read for the
 * budget: what each model call used, and the account's own reading of its limits.
 *
 * Codex 0.170.0 writes one after each model call, as a line `{"timestamp", "type": "event_msg", "payload": {"type":
 * "token_count", "info", "rate_limits"}}` (docs/design/codex-host-study.md, Budget). `info.last_token_usage` is that
 * call's use, `info.total_token_usage` the session's so far; `input_tokens` counts the cached input inside it, and
 * `output_tokens` the reasoning inside it, so the call's plain input is `input_tokens - cached_input_tokens` and its
 * output `output_tokens` alone. `rate_limits` holds a primary and a secondary window, each `used_percent`,
 * `window_minutes` and `resets_at` (epoch seconds); the week is the one of 10080 minutes. The windows are the
 * account's, so every chat on it repeats the same snapshot: a reader keeps the newest one, never a sum.
 *
 * A `token_count` whose fields are not of that shape is refused with the field that broke it, never read as no use:
 * a renamed field would otherwise read as a week with nothing spent. The live proof of the names is the study's 7th.
 */

import { isRecord, type CallUsage, type RateLimits, type RateWindow } from '../../../plugin-api/index.ts';

/** The window Codex names the week by, in minutes. */
export const WEEK_MINUTES = 10_080;

/** The five-hour window, which Codex names on a plan that has one. */
export const FIVE_HOUR_MINUTES = 300;

const MS_PER_SECOND = 1000;

/** A `token_count` read: the call's use, the model's context window, and the account's limits, each undefined when the event carries none. */
export interface TokenCount {
  readonly kind: 'token-count';
  /** When Codex wrote it, in epoch ms; undefined when the line has no readable time. */
  readonly at: number | undefined;
  readonly call: CallUsage | undefined;
  readonly contextWindow: number | undefined;
  readonly limits: RateLimits | undefined;
}

/** A `token_count` of a shape this reader does not know; `field` is the dotted path that broke it. */
export interface RefusedTokenCount {
  readonly kind: 'refused';
  readonly field: string;
}

type Json = Readonly<Record<string, unknown>>;

class ShapeError extends Error {
  override readonly name = 'ShapeError';

  readonly field: string;

  constructor(field: string) {
    super(`a Codex token_count with an unknown ${field}`);
    this.field = field;
  }
}

function parsed(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function count(record: Json, key: string, path: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ShapeError(`${path}.${key}`);
  }
  return value;
}

/** A call's use from a `TokenUsage`: the cached input apart from the plain, no cache write (Codex splits none out). */
function callOf(value: unknown, path: string): CallUsage {
  if (!isRecord(value)) {
    throw new ShapeError(path);
  }
  const input = count(value, 'input_tokens', path);
  const cached = count(value, 'cached_input_tokens', path);
  const output = count(value, 'output_tokens', path);
  if (cached > input) {
    throw new ShapeError(`${path}.cached_input_tokens`);
  }
  return { input: input - cached, cacheWrite5m: 0, cacheWrite1h: 0, cacheWriteUnsplit: 0, cacheRead: cached, output };
}

interface Window {
  readonly minutes: number;
  readonly window: RateWindow;
}

function windowOf(value: unknown, path: string): Window | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new ShapeError(path);
  }
  const usedPct = value['used_percent'];
  const minutes = value['window_minutes'];
  const resetsAt = value['resets_at'];
  if (typeof usedPct !== 'number' || !Number.isFinite(usedPct)) {
    throw new ShapeError(`${path}.used_percent`);
  }
  if (typeof minutes !== 'number' || !Number.isInteger(minutes)) {
    throw new ShapeError(`${path}.window_minutes`);
  }
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) {
    throw new ShapeError(`${path}.resets_at`);
  }
  return { minutes, window: { usedPct, resetsAt: resetsAt * MS_PER_SECOND } };
}

/** The week and five-hour windows of `rate_limits`, by their length; undefined when it names neither. */
function limitsOf(value: unknown): RateLimits | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new ShapeError('rate_limits');
  }
  const windows = [windowOf(value['primary'], 'rate_limits.primary'), windowOf(value['secondary'], 'rate_limits.secondary')];
  const of = (minutes: number): RateWindow | null => windows.find((window) => window?.minutes === minutes)?.window ?? null;
  const limits = { fiveHour: of(FIVE_HOUR_MINUTES), sevenDay: of(WEEK_MINUTES) };
  return limits.fiveHour === null && limits.sevenDay === null ? undefined : limits;
}

function infoOf(value: unknown): Pick<TokenCount, 'call' | 'contextWindow'> {
  if (value === null || value === undefined) {
    return { call: undefined, contextWindow: undefined };
  }
  if (!isRecord(value)) {
    throw new ShapeError('info');
  }
  callOf(value['total_token_usage'], 'info.total_token_usage');
  const window = value['model_context_window'];
  if (window !== null && window !== undefined && (typeof window !== 'number' || !Number.isInteger(window))) {
    throw new ShapeError('info.model_context_window');
  }
  return { call: callOf(value['last_token_usage'], 'info.last_token_usage'), contextWindow: typeof window === 'number' ? window : undefined };
}

function timeOf(value: unknown): number | undefined {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(at) ? undefined : at;
}

/**
 * One rollout line as its `token_count`, refused when the event is of an unknown shape; undefined for any other line,
 * a blank or damaged one included (the rollout's other readers say those).
 */
export function tokenCountOf(line: string): TokenCount | RefusedTokenCount | undefined {
  if (!line.includes('"token_count"')) {
    return undefined;
  }
  const value = parsed(line);
  if (!isRecord(value) || value['type'] !== 'event_msg') {
    return undefined;
  }
  const payload = value['payload'];
  if (!isRecord(payload) || payload['type'] !== 'token_count') {
    return undefined;
  }
  try {
    return { kind: 'token-count', at: timeOf(value['timestamp']), ...infoOf(payload['info']), limits: limitsOf(payload['rate_limits']) };
  } catch (error) {
    if (error instanceof ShapeError) {
      return { kind: 'refused', field: error.field };
    }
    throw error;
  }
}

/**
 * The account's reading of its limits from the `token_count`s of all its chats: the newest one that names any, by
 * the time Codex wrote it. Every chat repeats the same account-wide snapshot, so the readings are never added.
 */
export function accountLimits(counts: Iterable<TokenCount>): RateLimits | undefined {
  let newest: TokenCount | undefined;
  for (const reading of counts) {
    if (reading.limits !== undefined && reading.at !== undefined && (newest?.at === undefined || reading.at > newest.at)) {
      newest = reading;
    }
  }
  return newest?.limits;
}
