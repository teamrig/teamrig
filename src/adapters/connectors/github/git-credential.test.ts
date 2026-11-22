import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CredentialAsk } from '../../../core/git-credential.ts';
import { FakeCredentials } from '../../../testing/fake-credentials.ts';
import { githubGitAnswer, repoOfGitPath } from './git-credential.ts';
import { RepoTokens } from './tokens.ts';

const ASK: CredentialAsk = { protocol: 'https', host: 'github.com', path: 'Acme/app.git', username: undefined };

function keys(store: FakeCredentials): RepoTokens {
  return new RepoTokens(store, {});
}

describe('repoOfGitPath', () => {
  it('reads owner/name, with or without .git or a trailing slash, the owner in lowercase', () => {
    assert.deepEqual(repoOfGitPath('Acme/app.git'), { owner: 'acme', name: 'app' });
    assert.deepEqual(repoOfGitPath('acme/app/'), { owner: 'acme', name: 'app' });
    assert.deepEqual(repoOfGitPath('acme/my.app_2-x'), { owner: 'acme', name: 'my.app_2-x' });
  });

  it('reads no repository from any other path', () => {
    for (const path of ['', 'acme', 'acme/app/info/refs', '../app', 'acme/..', 'acme/.', 'ac%6De/app', 'acme/a%2Fb', 'ac me/app', 'acme//app']) {
      assert.equal(repoOfGitPath(path), undefined, path);
    }
  });
});

describe('githubGitAnswer', () => {
  it("gives git the owner's saved key for one of its repositories", async () => {
    const store = new FakeCredentials().saves('teamrig-gh-acme', 'acme-key');
    assert.deepEqual(await githubGitAnswer(ASK, keys(store)), { stdout: 'username=x-access-token\npassword=acme-key\n', note: undefined });
    assert.deepEqual(store.reads, ['teamrig-gh-acme']);
  });

  it('takes the host in any case, never as a suffix or with a port', async () => {
    const store = new FakeCredentials().saves('teamrig-gh-acme', 'acme-key');
    assert.match((await githubGitAnswer({ ...ASK, host: 'GitHub.com' }, keys(store))).stdout, /^username=/u);
    for (const host of ['evil-github.com', 'github.com.evil.example', 'github.com:443', 'api.github.com', undefined]) {
      const answer = await githubGitAnswer({ ...ASK, host }, keys(store));
      assert.equal(answer.stdout, 'quit=1\n', String(host));
      assert.match(answer.note ?? '', /keys are for github\.com/u);
    }
  });

  it('answers quit, reading no key, for any protocol but https', async () => {
    const store = new FakeCredentials().saves('teamrig-gh-acme', 'acme-key');
    for (const protocol of ['http', 'ssh', 'HTTPS', undefined]) {
      assert.equal((await githubGitAnswer({ ...ASK, protocol }, keys(store))).stdout, 'quit=1\n', String(protocol));
    }
    assert.deepEqual(store.reads, []);
  });

  it('answers quit for a URL naming a user, no path, or a path that is no repository', async () => {
    const store = new FakeCredentials().saves('teamrig-gh-acme', 'acme-key');
    assert.match((await githubGitAnswer({ ...ASK, username: 'octo' }, keys(store))).note ?? '', /names a user/u);
    assert.match((await githubGitAnswer({ ...ASK, path: undefined }, keys(store))).note ?? '', /useHttpPath true/u);
    assert.match((await githubGitAnswer({ ...ASK, path: 'acme/../globex/app' }, keys(store))).note ?? '', /no <owner>\/<name>/u);
    assert.deepEqual(store.reads, []);
  });

  it('answers quit, never a login, when no key is saved for the owner', async () => {
    const answer = await githubGitAnswer(ASK, keys(new FakeCredentials()));
    assert.equal(answer.stdout, 'quit=1\n');
    assert.match(answer.note ?? '', /no token for acme is saved as teamrig-gh-acme/u);
  });

  it('answers quit when the saved key would add a line to the answer', async () => {
    const answer = await githubGitAnswer(ASK, keys(new FakeCredentials().saves('teamrig-gh-acme', 'acme-key\nquit=0')));
    assert.equal(answer.stdout, 'quit=1\n');
    assert.match(answer.note ?? '', /no single line of text/u);
    assert.doesNotMatch(answer.note ?? '', /acme-key/u);
  });
});
