import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { testConfig } from '../testing/config.ts';
import { unheldOf } from './unheld.ts';

describe('unheldOf', () => {
  it('holds no session out of the budget on a team with no reviewer and no GitHub answerer', () => {
    assert.deepEqual([...unheldOf(testConfig(), 'app')], []);
  });

  it('keeps the security reviewer and the GitHub answerer out of the budget holds', () => {
    const config = testConfig({ roles: { lead: 'lead', securityReviewer: 'alpha' }, serviceRoles: { gh: { holders: ['bravo'], commands: ['issue close'] } } });
    assert.deepEqual([...unheldOf(config, 'app')], ['alpha', 'bravo']);
  });

  it('leaves a reviewer of a team above to that team, even one sharing an id with this team', () => {
    assert.deepEqual([...unheldOf(testConfig({ roles: { lead: 'lead', securityReviewer: 'root/alpha' } }), 'app')], []);
  });
});
