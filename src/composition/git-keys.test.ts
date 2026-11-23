import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CredentialAsk } from '../plugin-api/index.ts';
import { FakeCredentials } from '../testing/fake-credentials.ts';
import { gitKeys } from './git-keys.ts';

const ASK: CredentialAsk = { protocol: 'https', host: 'github.com', path: 'acme/app.git', username: undefined };

describe('gitKeys', () => {
  it("answers git's get with the owner's saved key, and quit for an owner with none", async () => {
    const keys = gitKeys(new FakeCredentials().savesTokensFor(['acme']));
    assert.match((await keys.answer(ASK)).stdout, /^username=x-access-token\npassword=.+\n$/u);
    const none = await keys.answer({ ...ASK, path: 'globex/app.git' });
    assert.equal(none.stdout, 'quit=1\n');
    assert.match(none.note ?? '', /no token for globex/u);
  });

  it('wires the helper for an origin whose owner has a saved key, and skips any other', async () => {
    const keys = gitKeys(new FakeCredentials().savesTokensFor(['acme']));
    assert.deepEqual(await keys.scopeOf('https://github.com/acme/app.git'), { urlPrefix: 'https://github.com', owner: 'acme' });
    assert.ok('skip' in (await keys.scopeOf('https://github.com/globex/app.git')));
    assert.ok('skip' in (await keys.scopeOf('https://gitlab.example/acme/app.git')));
  });

  it("picks each repository's key once for both answers", async () => {
    const store = new FakeCredentials().savesTokensFor(['acme']);
    const keys = gitKeys(store);
    await keys.scopeOf('https://github.com/acme/app.git');
    await keys.answer(ASK);
    assert.deepEqual(store.reads, ['teamrig-gh-acme.app', 'teamrig-gh-acme']);
  });
});
