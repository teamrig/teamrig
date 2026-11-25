import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { teamTabsOf } from './headroom.ts';

describe('teamTabsOf', () => {
  it("counts the team's running sessions and its loading tabs, each session once, and no other team's tab (T5479)", () => {
    const loading = [
      { team: 'app', session: 'alpha' },
      { team: 'app', session: 'bravo' },
      { team: 'ops', session: 'lead' },
    ];
    assert.equal(teamTabsOf('app', ['lead', 'alpha'], loading), 3, 'alpha is running and still loading: one tab');
    assert.equal(teamTabsOf('app', [], []), 0);
    assert.equal(teamTabsOf('ops', ['lead'], loading), 1);
  });
});
