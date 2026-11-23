import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REFRESH } from '../config/defaults.ts';
import { parseConfig } from '../config/parse.ts';
import { sessionSettingsOf, windowCapOf, windowWarningOf, WINDOW_SHARE } from './window.ts';

const ROSTER = { sessions: ['lead', 'web', 'api'], roles: { lead: 'lead' } };

function configOf(refresh: object): ReturnType<typeof parseConfig>['config'] {
  return parseConfig({ ...ROSTER, refresh }).config;
}

describe('windowCapOf (#1543)', () => {
  it('is 80% of the window reported, and of 200k when none is', () => {
    assert.equal(WINDOW_SHARE, 0.8);
    assert.deepEqual([windowCapOf(200_000), windowCapOf(1_000_000), windowCapOf(undefined)], [160_000, 800_000, 160_000]);
    assert.equal(windowCapOf(200_001), 160_000, 'rounded down');
  });

  it('stays under the compaction ceiling on a 200k window', () => {
    assert.ok(windowCapOf(undefined) < DEFAULT_REFRESH.compactCeilingTokens);
  });
});

describe('sessionSettingsOf (#1543)', () => {
  const config = configOf({ contextTokens: 170_000, sessionContextTokens: { lead: 500_000, web: 100_000 } });

  it("caps a session's own limit at its window's share, the window not reported counting as 200k", () => {
    assert.equal(sessionSettingsOf(config, 'lead', 1_000_000).contextTokens, 500_000);
    assert.equal(sessionSettingsOf(config, 'lead', 200_000).contextTokens, 160_000);
    assert.equal(sessionSettingsOf(config, 'lead', undefined).contextTokens, 160_000);
    assert.equal(sessionSettingsOf(config, 'web', undefined).contextTokens, 100_000, 'under the cap: as set');
  });

  it("leaves the team's contextTokens as it is on every window, and the rest of refresh", () => {
    assert.deepEqual(sessionSettingsOf(config, 'api', undefined), config.refresh);
    assert.deepEqual(sessionSettingsOf(config, 'api', 200_000), config.refresh);
    assert.deepEqual(sessionSettingsOf(config, 'lead', 1_000_000), { ...config.refresh, contextTokens: 500_000 });
  });
});

describe('windowWarningOf (#1543)', () => {
  const config = configOf({ sessionContextTokens: { lead: 900_000, web: 100_000 } });

  it('tells once per window that a session limit is capped, the window counted when none is reported', () => {
    const unreported = windowWarningOf(config, 'lead', {}, 'teamrig');
    assert.deepEqual(unreported, {
      line: 'teamrig: refresh.sessionContextTokens.lead (900k) is past 80% of the 200k context window counted while none is reported, so lead refreshes at 160k',
      warned: 200_000,
    });
    assert.equal(windowWarningOf(config, 'lead', { windowWarned: 200_000 }, 'teamrig'), undefined, 'told on this window already');
    assert.equal(windowWarningOf(config, 'lead', { window: 200_000, windowWarned: 200_000 }, 'teamrig'), undefined, 'the same window, now reported');
    assert.deepEqual(windowWarningOf(config, 'lead', { window: 1_000_000, windowWarned: 200_000 }, 'teamrig'), {
      line: 'teamrig: refresh.sessionContextTokens.lead (900k) is past 80% of its 1000k context window, so lead refreshes at 800k',
      warned: 1_000_000,
    });
  });

  it('says nothing for a limit under the cap, nor for the team threshold', () => {
    assert.equal(windowWarningOf(config, 'web', {}, 'teamrig'), undefined);
    assert.equal(windowWarningOf(config, 'lead', { window: 2_000_000 }, 'teamrig'), undefined);
    assert.equal(windowWarningOf(configOf({ contextTokens: 300_000 }), 'api', {}, 'teamrig'), undefined);
  });
});
