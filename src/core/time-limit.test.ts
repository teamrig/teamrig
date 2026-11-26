import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { CHECK_TIME_SCALE, MAX_TIME_SCALE, scaledLimitMs, timeScale, withCheckTimeScale } from './time-limit.ts';

describe('timeScale', () => {
  it('reads a scale from 1 to the largest as written, a fraction too', () => {
    assert.equal(timeScale({ TEAMRIG_TIME_SCALE: '4' }), 4);
    assert.equal(timeScale({ TEAMRIG_TIME_SCALE: ' 2.5 ' }), 2.5);
    assert.equal(timeScale({ TEAMRIG_TIME_SCALE: String(MAX_TIME_SCALE) }), MAX_TIME_SCALE);
  });

  it('reads 1 when unset, blank, not a number or below 1, so a scale never shortens a limit', () => {
    for (const raw of [undefined, '', '  ', 'fast', 'NaN', 'Infinity', '0', '0.5', '-3']) {
      assert.equal(timeScale({ TEAMRIG_TIME_SCALE: raw }), 1, `scale ${String(raw)}`);
    }
  });

  it('reads the largest past it, so a typo cannot turn a limit off', () => {
    assert.equal(timeScale({ TEAMRIG_TIME_SCALE: '4000' }), MAX_TIME_SCALE);
  });
});

describe('scaledLimitMs', () => {
  it('stretches a limit by the scale, in whole milliseconds, and keeps it as written with no scale', () => {
    assert.equal(scaledLimitMs(10_000, {}), 10_000);
    assert.equal(scaledLimitMs(5_000, { TEAMRIG_TIME_SCALE: '4' }), 20_000);
    assert.equal(scaledLimitMs(333, { TEAMRIG_TIME_SCALE: '1.5' }), 500);
  });

  it('still stops a child that runs past the stretched limit', () => {
    const limit = scaledLimitMs(100, { TEAMRIG_TIME_SCALE: String(CHECK_TIME_SCALE) });
    const started = Date.now();
    const run = spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { windowsHide: true, timeout: limit });
    const elapsed = Date.now() - started;
    assert.equal(limit, 400);
    assert.equal(run.status, null, 'the child was stopped, not left to end by itself');
    assert.ok(elapsed >= limit, `stopped after ${elapsed} ms, before the ${limit} ms limit`);
    assert.ok(elapsed < 10_000, `stopped after ${elapsed} ms, when the child ended by itself`);
  });
});

describe('withCheckTimeScale', () => {
  it("adds the check's scale and keeps the rest", () => {
    assert.deepEqual(withCheckTimeScale({ PATH: '/usr/bin' }), { PATH: '/usr/bin', TEAMRIG_TIME_SCALE: String(CHECK_TIME_SCALE) });
  });

  it("keeps a person's own scale, even one that reads 1", () => {
    assert.deepEqual(withCheckTimeScale({ TEAMRIG_TIME_SCALE: '1' }), { TEAMRIG_TIME_SCALE: '1' });
  });
});
