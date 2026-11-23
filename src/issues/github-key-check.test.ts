import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeHttp } from '../testing/fake-http.ts';
import { checkGithubKey, expiryOf, GITHUB_KEY_CHECK_URL, githubKeyKindOf, keyCheckText } from './github-key-check.ts';

const NOW = Date.parse('2030-01-08T10:00:00Z');
const FINE = 'github_pat_fake';

describe('checkGithubKey', () => {
  it('sends the key only to GitHub API host over https, and reads its owner, kind and expiry', async () => {
    const http = new FakeHttp().answers('GET', GITHUB_KEY_CHECK_URL, 200, '{"login":"octo"}', { 'github-authentication-token-expiration': '2030-02-01 10:00:00 UTC' });
    const check = await checkGithubKey(http, FINE);
    assert.deepEqual(check, { kind: 'valid', login: 'octo', keyKind: 'fine-grained', scopes: undefined, expires: Date.parse('2030-02-01T10:00:00Z') });
    assert.equal(http.requests.length, 1);
    assert.equal(http.requests[0]?.url, 'https://api.github.com/user');
    assert.equal(http.requests[0]?.headers?.['authorization'], `Bearer ${FINE}`);
  });

  it("reads a classic key's scopes and a key with no expiry", async () => {
    const http = new FakeHttp().answers('GET', GITHUB_KEY_CHECK_URL, 200, '{"login":"octo"}', { 'x-oauth-scopes': 'repo, workflow' });
    const check = await checkGithubKey(http, 'ghp_fake');
    assert.deepEqual(check, { kind: 'valid', login: 'octo', keyKind: 'classic', scopes: ['repo', 'workflow'], expires: 'none' });
  });

  it('is rejected on 401, and failed on no answer or an answer with no user', async () => {
    assert.deepEqual(await checkGithubKey(new FakeHttp().answers('GET', GITHUB_KEY_CHECK_URL, 401), FINE), { kind: 'rejected', status: 401 });
    assert.deepEqual(await checkGithubKey(new FakeHttp().failsOn('GET', GITHUB_KEY_CHECK_URL, 'GitHub could not be reached'), FINE), {
      kind: 'failed',
      reason: 'GitHub could not be reached',
    });
    assert.deepEqual(await checkGithubKey(new FakeHttp().answers('GET', GITHUB_KEY_CHECK_URL, 200, 'not json'), FINE), {
      kind: 'failed',
      reason: 'GitHub answered 200 with no user',
    });
  });
});

describe('githubKeyKindOf', () => {
  it('reads the kind from the documented prefix', () => {
    assert.equal(githubKeyKindOf('github_pat_x'), 'fine-grained');
    assert.equal(githubKeyKindOf('ghp_x'), 'classic');
    assert.equal(githubKeyKindOf('gho_x'), 'app or OAuth');
    assert.equal(githubKeyKindOf('plain'), 'unknown');
  });
});

describe('expiryOf', () => {
  it('reads UTC and offset forms, and nothing else', () => {
    assert.equal(expiryOf('2030-02-01 10:00:00 UTC'), Date.parse('2030-02-01T10:00:00Z'));
    assert.equal(expiryOf('2030-02-01 12:00:00 +0200'), Date.parse('2030-02-01T10:00:00Z'));
    assert.equal(expiryOf('next week'), undefined);
  });
});

describe('keyCheckText', () => {
  it('says owner, kind, rights and expiry of a fine-grained key with no warning', () => {
    const text = keyCheckText({ kind: 'valid', login: 'octo', keyKind: 'fine-grained', scopes: undefined, expires: Date.parse('2030-03-01T00:00:00Z') }, NOW);
    assert.deepEqual(text, { summary: 'octo, fine-grained, rights set per repository, expires 2030-03-01', warnings: [] });
  });

  it('warns on a classic key that never expires', () => {
    const text = keyCheckText({ kind: 'valid', login: 'octo', keyKind: 'classic', scopes: ['repo'], expires: 'none' }, NOW);
    assert.equal(text.summary, 'octo, classic, scopes repo, no expiry');
    assert.equal(text.warnings.length, 2);
    assert.match(text.warnings[0] ?? '', /fine-grained key limited to the team's repositories/u);
    assert.match(text.warnings[1] ?? '', /never expires/u);
  });

  it('warns on a key within 7 days of its expiry, and on one past it', () => {
    const soon = keyCheckText({ kind: 'valid', login: 'octo', keyKind: 'fine-grained', scopes: undefined, expires: NOW + 3 * 86_400_000 + 1 }, NOW);
    assert.match(soon.warnings.join('\n'), /expires in 3 day\(s\)/u);
    const past = keyCheckText({ kind: 'valid', login: 'octo', keyKind: 'fine-grained', scopes: undefined, expires: NOW - 1 }, NOW);
    assert.equal(past.summary, 'octo, fine-grained, rights set per repository, expired 2030-01-08');
    assert.match(past.warnings.join('\n'), /expired on 2030-01-08/u);
  });
});
