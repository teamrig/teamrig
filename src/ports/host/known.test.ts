import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hostCannotTell, knownFrom } from './known.ts';

describe('a fact a host reported', () => {
  it('is known with where it was read when the host told it', () => {
    assert.deepEqual(knownFrom('opus', 'status-line'), { known: true, value: 'opus', source: 'status-line' });
  });

  it('keeps a told falsy value as known, never as untold', () => {
    assert.deepEqual(knownFrom('', 'hook-input'), { known: true, value: '', source: 'hook-input' });
    assert.deepEqual(knownFrom(0, 'environment'), { known: true, value: 0, source: 'environment' });
  });

  it('is unknown as not told when the host told none, unless the caller says the host cannot tell it', () => {
    assert.deepEqual(knownFrom(undefined, 'hook-input'), { known: false, why: 'not-told' });
    assert.deepEqual(knownFrom(undefined, 'hook-input', 'host-cannot-tell'), { known: false, why: 'host-cannot-tell' });
    assert.deepEqual(hostCannotTell(), { known: false, why: 'host-cannot-tell' });
  });
});
