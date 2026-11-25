import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tokenCountOf } from './token-count.ts';
import { usageMeter, WEIGHTS } from './usage.ts';

const NONE = { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheWriteUnsplit: 0, cacheRead: 0, output: 0 };

/** A token_count line as Codex 0.170.0 writes one, with the week told in its rate_limits. */
const TOKEN_COUNT = JSON.stringify({
  timestamp: '2030-01-08T09:00:00.000Z',
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      total_token_usage: { input_tokens: 12_000, cached_input_tokens: 9_000, output_tokens: 700, reasoning_output_tokens: 300, total_tokens: 12_700 },
      last_token_usage: { input_tokens: 12_000, cached_input_tokens: 9_000, output_tokens: 700, reasoning_output_tokens: 300, total_tokens: 12_700 },
      model_context_window: 272_000,
    },
    rate_limits: { primary: { used_percent: 41, window_minutes: 10_080, resets_at: 1_894_000_000 }, secondary: null },
  },
});

describe("Codex CLI's usage meter", () => {
  it('prices a cached input token at a tenth of a plain one and an output token at eight', () => {
    assert.equal(usageMeter.ofCall({ ...NONE, input: 1000 }), 1000);
    assert.equal(usageMeter.ofCall({ ...NONE, cacheRead: 1000 }), 100);
    assert.equal(usageMeter.ofCall({ ...NONE, output: 1000 }), 8000);
    assert.equal(usageMeter.ofCall(NONE), 0);
  });

  it('prices a call the token_count reader gave as the sum of its kinds, its reasoning inside the output', () => {
    const count = tokenCountOf(TOKEN_COUNT);
    const call = count?.kind === 'token-count' ? count.call : undefined;
    assert.ok(call !== undefined, JSON.stringify(count));
    assert.equal(usageMeter.ofCall(call), 3_000 * WEIGHTS.input + 9_000 * WEIGHTS.cacheRead + 700 * WEIGHTS.output);
  });

  it('reads the plain and cached input as the context, never the output', () => {
    assert.equal(usageMeter.contextReading({ ...NONE, input: 3_000, cacheRead: 9_000, output: 700 }), 12_000);
    assert.equal(usageMeter.contextReading({ ...NONE, output: 700 }), 0);
  });

  it('prices a cache write of a call from any reader like plain input, since Codex reports none', () => {
    assert.equal(usageMeter.ofCall({ ...NONE, cacheWrite5m: 10, cacheWrite1h: 10, cacheWriteUnsplit: 10 }), 30);
  });

  it('says how many characters make a token', () => {
    assert.ok(usageMeter.charsPerToken > 0);
  });

  it('reads no week from a status text, since Codex hands a program none, even one that names rate_limits', () => {
    assert.equal(usageMeter.weekReading(TOKEN_COUNT), undefined);
    assert.equal(usageMeter.weekReading(''), undefined);
  });

  it("reads the week from a rollout tail's newest token_count, dated by its own timestamp, past a cut first line (T5060)", () => {
    const newer = TOKEN_COUNT.replace('2030-01-08T09:00:00.000Z', '2030-01-08T10:00:00.000Z').replace('"used_percent":41', '"used_percent":43');
    const tail = [TOKEN_COUNT.slice(20), newer, TOKEN_COUNT, '{"type":"response_item"}', ''].join('\n');
    const reading = usageMeter.transcriptWeekReading?.(tail);
    assert.deepEqual(reading, { limits: { fiveHour: null, sevenDay: { usedPct: 43, resetsAt: 1_894_000_000_000 } }, at: Date.parse('2030-01-08T10:00:00.000Z') });
  });

  it('reads no week from a tail with no token_count naming one (T5060)', () => {
    assert.equal(usageMeter.transcriptWeekReading?.('{"type":"response_item"}\n'), undefined);
    assert.equal(usageMeter.transcriptWeekReading?.(TOKEN_COUNT.replace(/"rate_limits":\{.*\}\}\}$/, '"rate_limits":null}}')), undefined);
  });
});
