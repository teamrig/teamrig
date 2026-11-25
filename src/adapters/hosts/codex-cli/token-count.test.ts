import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accountLimits, newestLimits, tokenCountOf, tokenCountsOf, type TokenCount } from './token-count.ts';

const AT = '2030-01-08T09:00:00.000Z';
const RESETS_S = 1_894_000_000;
const USAGE = { input_tokens: 12_000, cached_input_tokens: 9_000, output_tokens: 700, reasoning_output_tokens: 300, total_tokens: 12_700 };
const TOTAL = { input_tokens: 50_000, cached_input_tokens: 40_000, output_tokens: 2_000, reasoning_output_tokens: 900, total_tokens: 52_000 };
const FIVE_HOUR = { used_percent: 12.5, window_minutes: 300, resets_at: RESETS_S - 3600 };
const WEEK = { used_percent: 41, window_minutes: 10_080, resets_at: RESETS_S };

/** A rollout line as Codex 0.170.0 writes a token_count event, with `payload` over the usual one. */
function line(payload: Readonly<Record<string, unknown>> = {}, timestamp: string = AT): string {
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: { type: 'token_count', info: { total_token_usage: TOTAL, last_token_usage: USAGE, model_context_window: 272_000 }, rate_limits: { primary: FIVE_HOUR, secondary: WEEK }, ...payload },
  });
}

function read(text: string): TokenCount {
  const count = tokenCountOf(text);
  assert.equal(count?.kind, 'token-count', JSON.stringify(count));
  return count?.kind === 'token-count' ? count : assert.fail('not a token count');
}

describe('tokenCountOf', () => {
  it("reads the call's use with the cached input apart, its context window and the week and five-hour windows", () => {
    assert.deepEqual(read(line()), {
      kind: 'token-count',
      at: Date.parse(AT),
      call: { input: 3_000, cacheWrite5m: 0, cacheWrite1h: 0, cacheWriteUnsplit: 0, cacheRead: 9_000, output: 700 },
      contextWindow: 272_000,
      limits: { fiveHour: { usedPct: 12.5, resetsAt: (RESETS_S - 3600) * 1000 }, sevenDay: { usedPct: 41, resetsAt: RESETS_S * 1000 } },
    });
  });

  it('finds the week by its length in either window, and has no limits when neither is a week or five hours', () => {
    assert.deepEqual(read(line({ rate_limits: { primary: WEEK, secondary: null } })).limits, { fiveHour: null, sevenDay: { usedPct: 41, resetsAt: RESETS_S * 1000 } });
    assert.equal(read(line({ rate_limits: { primary: { ...WEEK, window_minutes: 43_200 } } })).limits, undefined);
    assert.equal(read(line({ rate_limits: null })).limits, undefined);
  });

  it('reads an event with no info as no call, as Codex writes one with only the limits', () => {
    const count = read(line({ info: null }));
    assert.equal(count.call, undefined);
    assert.equal(count.contextWindow, undefined);
    assert.notEqual(count.limits, undefined);
  });

  it('refuses a token_count of an unknown shape, naming the field, never reading it as no use', () => {
    const cases: readonly (readonly [Readonly<Record<string, unknown>>, string])[] = [
      [{ info: 'none' }, 'info'],
      [{ info: { total_token_usage: TOTAL, last_token_usage: { ...USAGE, input_tokens: '12000' } } }, 'info.last_token_usage.input_tokens'],
      [{ info: { total_token_usage: { ...TOTAL, output_tokens: undefined }, last_token_usage: USAGE } }, 'info.total_token_usage.output_tokens'],
      [{ info: { total_token_usage: TOTAL, last_token_usage: { ...USAGE, cached_input_tokens: 13_000 } } }, 'info.last_token_usage.cached_input_tokens'],
      [{ info: { total_token_usage: TOTAL } }, 'info.last_token_usage'],
      [{ rate_limits: { primary: { ...WEEK, used_percent: '41' } } }, 'rate_limits.primary.used_percent'],
      [{ rate_limits: { secondary: { ...WEEK, resets_at: undefined, resets_in_seconds: 60 } } }, 'rate_limits.secondary.resets_at'],
      [{ rate_limits: [] }, 'rate_limits'],
    ];
    for (const [payload, field] of cases) {
      assert.deepEqual(tokenCountOf(line(payload)), { kind: 'refused', field }, field);
    }
  });

  it('passes over every other line, a damaged or blank one too', () => {
    const others = ['', '{"type":"event_msg"', JSON.stringify({ timestamp: AT, type: 'event_msg', payload: { type: 'agent_message', message: 'token_count' } }), JSON.stringify({ type: 'response_item', payload: { type: 'token_count' } })];
    for (const other of others) {
      assert.equal(tokenCountOf(other), undefined, other);
    }
  });
});

describe('accountLimits', () => {
  it("keeps the newest reading of all the account's chats, never their sum, and none when no chat told one", () => {
    const older = read(line({ rate_limits: { secondary: { ...WEEK, used_percent: 40 } } }, '2030-01-08T08:00:00.000Z'));
    const newer = read(line({ rate_limits: { secondary: { ...WEEK, used_percent: 43 } } }, '2030-01-08T10:00:00.000Z'));
    const silent = read(line({ rate_limits: null }, '2030-01-08T11:00:00.000Z'));
    assert.equal(accountLimits([newer, older, silent])?.sevenDay?.usedPct, 43);
    assert.equal(accountLimits([silent]), undefined);
  });
});

describe('newestLimits and tokenCountsOf', () => {
  it("keeps the newest reading with the time Codex wrote it, from a text's token_count lines alone (T5060)", () => {
    const older = line({ rate_limits: { secondary: { ...WEEK, used_percent: 40 } } }, '2030-01-08T08:00:00.000Z');
    const newer = line({ rate_limits: { secondary: { ...WEEK, used_percent: 43 } } }, '2030-01-08T10:00:00.000Z');
    const counts = tokenCountsOf([newer, '{"type":"response_item"}', line({ info: 'x' }), older, ''].join('\n'));
    assert.equal(counts.length, 2, 'the other line and the refused one are left out');
    assert.deepEqual(newestLimits(counts), { limits: { fiveHour: null, sevenDay: { usedPct: 43, resetsAt: RESETS_S * 1000 } }, at: Date.parse('2030-01-08T10:00:00.000Z') });
    assert.equal(newestLimits([]), undefined);
  });
});
