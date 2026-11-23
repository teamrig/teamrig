import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GITHUB } from '../config/defaults.ts';
import { issueAssigneesOf } from './issue-assignees.ts';

describe('the issue assignees of a team', () => {
  it('map each session to its login and keep the design assignees in their order', () => {
    const who = issueAssigneesOf({ github: { ...DEFAULT_GITHUB, owners: { 'Dev-Login': 'dev', 'lead-login': 'lead' }, designAssignees: ['owner-b', 'owner-a'] } });
    assert.deepEqual([...who.logins], [
      ['dev', 'Dev-Login'],
      ['lead', 'lead-login'],
    ]);
    assert.deepEqual(who.design, ['owner-b', 'owner-a']);
  });

  it('are empty for a team that names no logins', () => {
    const who = issueAssigneesOf({ github: DEFAULT_GITHUB });
    assert.equal(who.logins.size, 0);
    assert.deepEqual(who.design, []);
  });
});
