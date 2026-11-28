import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { antigravityUsageMeter, CHARS_PER_TOKEN, WEIGHTS } from './usage.ts';

describe('antigravityUsageMeter', () => {
  it('computes weighted tokens and context reading from CallUsage', () => {
    const call = { input: 2238, cacheWrite5m: 0, cacheWrite1h: 0, cacheWriteUnsplit: 0, cacheRead: 7495, output: 17 };
    assert.equal(antigravityUsageMeter.weights, WEIGHTS);
    assert.equal(antigravityUsageMeter.charsPerToken, CHARS_PER_TOKEN);
    assert.equal(antigravityUsageMeter.ofCall(call), 2238 + 749.5 + 85);
    assert.equal(antigravityUsageMeter.contextReading(call), 9733);
    assert.equal(antigravityUsageMeter.weekReading('{}'), undefined);
  });
});
