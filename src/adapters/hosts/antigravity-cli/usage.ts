import type { CallUsage, TokenWeights, UsageMeter } from '../../../plugin-api/index.ts';

/**
 * Antigravity CLI's usage meter.
 *
 * Live `agy 1.5.14` transcripts report `input_tokens`, `cache_read_tokens`, and `output_tokens` with no cache-write
 * split. Weights are an estimate (`input: 1`, `cacheRead: 0.1`, `output: 5`) until published.
 */
export const WEIGHTS: TokenWeights = {
  input: 1,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheWriteUnsplit: 0,
  cacheRead: 0.1,
  output: 5,
};

export const CHARS_PER_TOKEN = 4;

function ofCall(usage: CallUsage): number {
  return (
    usage.input * WEIGHTS.input +
    usage.cacheWrite5m * WEIGHTS.cacheWrite5m +
    usage.cacheWrite1h * WEIGHTS.cacheWrite1h +
    usage.cacheWriteUnsplit * WEIGHTS.cacheWriteUnsplit +
    usage.cacheRead * WEIGHTS.cacheRead +
    usage.output * WEIGHTS.output
  );
}

function contextReading(usage: CallUsage): number {
  return usage.input + usage.cacheWrite5m + usage.cacheWrite1h + usage.cacheWriteUnsplit + usage.cacheRead;
}

/** Antigravity CLI's usage meter. */
export const antigravityUsageMeter: UsageMeter = {
  weights: WEIGHTS,
  charsPerToken: CHARS_PER_TOKEN,
  ofCall,
  contextReading,
  weekReading: () => undefined,
};
