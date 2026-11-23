import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from './parse.ts';
import { autoRestartOf, sessionRefreshOf } from './refresh.ts';

const ROSTER = { sessions: ['lead', 'web', 'api'], roles: { lead: 'lead' } };

describe('autoRestartOf', () => {
  it("turns the automatic restart on for the lead only by default and with 'lead'", () => {
    for (const refresh of [{}, { autoRestart: 'lead' }]) {
      const { config, issues } = parseConfig({ ...ROSTER, refresh });
      assert.deepEqual(issues, []);
      assert.equal(config.refresh.autoRestart, 'lead');
      assert.deepEqual(['lead', 'web', 'api'].map((id) => autoRestartOf(config, id)), [true, false, false]);
    }
  });

  it('keeps true and false for every session', () => {
    const on = parseConfig({ ...ROSTER, refresh: { autoRestart: true } }).config;
    assert.deepEqual(['lead', 'web'].map((id) => autoRestartOf(on, id)), [true, true]);
    const off = parseConfig({ ...ROSTER, refresh: { autoRestart: false } }).config;
    assert.deepEqual(['lead', 'web'].map((id) => autoRestartOf(off, id)), [false, false]);
  });

  it('refuses any other value, keeping the default', () => {
    const { config, issues } = parseConfig({ ...ROSTER, refresh: { autoRestart: 'members' } });
    assert.deepEqual(issues.map((issue) => issue.path), ['refresh.autoRestart']);
    assert.equal(config.refresh.autoRestart, 'lead');
  });
});

describe('sessionRefreshOf', () => {
  it('keeps contextTokens for every session, one launched on a 1M window too (T4083)', () => {
    const { config } = parseConfig({ ...ROSTER, launch: { web: { model: 'opus[1m]' } }, refresh: { autoRestart: true } });
    assert.deepEqual(['lead', 'web', 'api'].map((id) => sessionRefreshOf(config, id)), [config.refresh, config.refresh, config.refresh]);
    assert.equal(sessionRefreshOf(config, 'web').contextTokens, 120_000);
  });
});

describe('sessionRefreshOf with refresh.sessionContextTokens (#1543)', () => {
  it("gives a session named there its own limit in place of contextTokens, and every other the team's", () => {
    const { config } = parseConfig({ ...ROSTER, refresh: { contextTokens: 130_000, sessionContextTokens: { lead: 500_000 } } });
    assert.deepEqual(sessionRefreshOf(config, 'lead'), { ...config.refresh, contextTokens: 500_000 });
    assert.deepEqual(sessionRefreshOf(config, 'web'), config.refresh);
    assert.equal(sessionRefreshOf(config, 'api').contextTokens, 130_000);
  });

  it('gives a session its own limit under the team threshold too', () => {
    const { config } = parseConfig({ ...ROSTER, refresh: { sessionContextTokens: { web: 80_000 } } });
    assert.equal(sessionRefreshOf(config, 'web').contextTokens, 80_000);
    assert.equal(sessionRefreshOf(config, 'lead').contextTokens, 120_000);
  });
});
