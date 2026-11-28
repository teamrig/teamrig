import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IssueComment } from '../../../plugin-api/index.ts';
import { markGithubPost } from './post-marks.ts';

const TEAM_LOGINS: ReadonlySet<string> = new Set(['octocat']);
const NO_ONE: ReadonlySet<string> = new Set();
const post = (login: string, authorAssociation: string, authorKind = 'User'): IssueComment => ({ at: '2026-11-15T08:00:00Z', login, authorAssociation, authorKind });

describe('markGithubPost (T3380, T5796)', () => {
  it("marks the team's logins, whatever their case, and the repository's owner ours, and no other tie", () => {
    assert.equal(markGithubPost(post('OctoCat', 'NONE'), TEAM_LOGINS), 'ours');
    assert.equal(markGithubPost(post('acme', 'OWNER'), TEAM_LOGINS), 'ours');
    assert.equal(markGithubPost(post('contrib', 'COLLABORATOR'), TEAM_LOGINS), 'theirs');
    assert.equal(markGithubPost(post('', 'MEMBER'), TEAM_LOGINS), 'theirs');
  });

  it('falls back to the tie to the repository when the team names no login', () => {
    assert.equal(markGithubPost(post('contrib', 'COLLABORATOR'), NO_ONE), 'ours');
    assert.equal(markGithubPost(post('ada', 'CONTRIBUTOR'), NO_ONE), 'theirs');
  });

  it("marks a bot's post none, whatever its tie, so it neither starts nor stops a clock", () => {
    assert.equal(markGithubPost(post('ci-bot', 'NONE', 'Bot'), NO_ONE), 'none');
    assert.equal(markGithubPost(post('octocat', 'OWNER', 'Bot'), TEAM_LOGINS), 'none');
  });
});
