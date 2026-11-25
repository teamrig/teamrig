import type { CallUsage, DatedRateLimits, RateLimits, TokenWeights, UsageMeter } from '../../../plugin-api/index.ts';
import { newestLimits, tokenCountsOf } from './token-count.ts';

/**
 * What Codex CLI's plan charges for each kind of token, against a plain input token: a cached input token 0.1, an
 * output token (its reasoning inside it) 8. They are the ratios of OpenAI's published API prices for the GPT-5 models
 * Codex runs, an estimate until the study's 7th proof fits them to a plan's week. Codex reports no cache write, so its
 * three prices only keep a call the transcript reader gave from any other host priced like input.
 */
export const WEIGHTS: TokenWeights = {
  input: 1,
  cacheWrite5m: 1,
  cacheWrite1h: 1,
  cacheWriteUnsplit: 1,
  cacheRead: 0.1,
  output: 8,
};

/** About how many characters of a tool's output OpenAI's tokenizers read as one token: OpenAI's own rule of thumb. */
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

/** Everything the model was sent for the call, cached or not; the output is what it wrote back. */
function contextReading(usage: CallUsage): number {
  return usage.input + usage.cacheWrite5m + usage.cacheWrite1h + usage.cacheWriteUnsplit + usage.cacheRead;
}

/**
 * Codex hands no status input to a program: it has no status line command. Its week is the `rate_limits` of the
 * rollouts' `token_count` events (transcriptWeekReading), so a status text never tells one.
 */
function weekReading(): RateLimits | undefined {
  return undefined;
}

/**
 * The account's newest reading of its windows among the `token_count`s of a rollout's tail, dated by the event's own
 * timestamp: the time Codex took it, never the time it was read.
 */
function transcriptWeekReading(tail: string): DatedRateLimits | undefined {
  return newestLimits(tokenCountsOf(tail));
}

/** Codex CLI's usage meter. */
export const usageMeter: UsageMeter = { weights: WEIGHTS, charsPerToken: CHARS_PER_TOKEN, ofCall, contextReading, weekReading, transcriptWeekReading };
