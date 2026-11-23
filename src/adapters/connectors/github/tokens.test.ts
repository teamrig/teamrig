import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FakeCredentials } from '../../../testing/fake-credentials.ts';
import { NoAccessError, OwnKeyError, repoOwner, RepoTokens, TokenMissingError, TokenReadError } from './tokens.ts';

const ENV = { HOME: '/u' };

describe('repoOwner', () => {
  it('gives the owner of owner/name in lowercase', () => {
    assert.equal(repoOwner('Acme/Web'), 'acme');
  });
});

describe('RepoTokens', () => {
  it("gives gh an owner's token only for that owner's repositories, picking each repository once", async () => {
    const store = new FakeCredentials().saves('teamrig-gh-acme', 'acme-token');
    const tokens = new RepoTokens(store, ENV);
    assert.deepEqual(await tokens.accessFor('acme/web'), {
      env: { HOME: '/u', GH_TOKEN: 'acme-token' }, owner: 'acme', scope: 'acme', credential: 'teamrig-gh-acme', save: 'save teamrig-gh-acme',
    });
    await tokens.accessFor('Acme/Web');
    const api = await tokens.accessFor('acme/api');
    assert.ok(!(api instanceof NoAccessError));
    assert.equal(api.env['GH_TOKEN'], 'acme-token');
    assert.ok(await tokens.accessFor('globex/api') instanceof NoAccessError);
    assert.deepEqual(store.reads, [
      'teamrig-gh-acme.web', 'teamrig-gh-acme', 'teamrig-gh-acme.api', 'teamrig-gh-acme', 'teamrig-gh-globex.api', 'teamrig-gh-globex',
    ]);
  });

  it("gives a repository's own key ahead of its owner's, and the owner's to the owner's other repositories", async () => {
    const store = new FakeCredentials().saves('teamrig-gh-acme', 'acme-token').saves('teamrig-gh-acme.web', 'web-token');
    const tokens = new RepoTokens(store, ENV);
    assert.deepEqual(await tokens.accessFor('Acme/Web'), {
      env: { HOME: '/u', GH_TOKEN: 'web-token' }, owner: 'acme', scope: 'acme/web', credential: 'teamrig-gh-acme.web', save: 'save teamrig-gh-acme.web',
    });
    const api = await tokens.accessFor('acme/api');
    assert.ok(!(api instanceof NoAccessError));
    assert.equal(api.scope, 'acme');
    const owner = await tokens.accessForOwner('acme');
    assert.ok(!(owner instanceof NoAccessError));
    assert.equal(owner.env['GH_TOKEN'], 'acme-token');
  });

  it("gives no access, never the owner's key, when a repository's own key is saved but cannot be read", async () => {
    const store = new FakeCredentials().saves('teamrig-gh-acme', 'acme-token').failsOn('teamrig-gh-acme.web', 'the keyring is locked');
    const access = await new RepoTokens(store, ENV).accessFor('acme/web');
    assert.ok(access instanceof TokenReadError);
    assert.equal(
      access.message,
      'could not read teamrig-gh-acme.web from the test store: the keyring is locked; unlock the store and rerun, or save the key again with: save teamrig-gh-acme.web',
    );
    assert.deepEqual(store.reads, ['teamrig-gh-acme.web']);
  });

  it("reaches a repository whose own key name would be too long through its owner's key", async () => {
    const store = new FakeCredentials().saves('teamrig-gh-acme', 'acme-token');
    const access = await new RepoTokens(store, ENV).accessFor(`acme/${'w'.repeat(120)}`);
    assert.ok(!(access instanceof NoAccessError));
    assert.equal(access.scope, 'acme');
    assert.deepEqual(store.reads, ['teamrig-gh-acme']);
  });

  it("gives several repositories of one owner the owner's key only when none has a key of its own", async () => {
    const none = new FakeCredentials().saves('teamrig-gh-acme', 'acme-token');
    const owner = await new RepoTokens(none, ENV).accessForRepos('Acme', ['acme/web', 'acme/api']);
    assert.ok(!(owner instanceof NoAccessError));
    assert.equal(owner.scope, 'acme');
    assert.deepEqual(none.reads, ['teamrig-gh-acme.web', 'teamrig-gh-acme.api', 'teamrig-gh-acme']);

    const own = new FakeCredentials().saves('teamrig-gh-acme', 'acme-token').saves('teamrig-gh-acme.api', 'api-token');
    const refused = await new RepoTokens(own, ENV).accessForRepos('acme', ['acme/web', 'acme/api']);
    assert.ok(refused instanceof OwnKeyError);
    assert.match(refused.message, /it reaches acme\/web, acme\/api, and acme\/api has a key of its own/u);
    assert.ok(!own.reads.includes('teamrig-gh-acme'));

    const locked = new FakeCredentials().saves('teamrig-gh-acme', 'acme-token').failsOn('teamrig-gh-acme.web', 'the keyring is locked');
    assert.ok(await new RepoTokens(locked, ENV).accessForRepos('acme', ['acme/web', 'acme/api']) instanceof TokenReadError);
    assert.deepEqual(locked.reads, ['teamrig-gh-acme.web']);
  });

  it('gives no access, never the gh login, when no key is saved for the owner', async () => {
    const access = await new RepoTokens(new FakeCredentials(), { HOME: '/u', GH_TOKEN: 'login-token' }).accessFor('globex/api');
    assert.ok(access instanceof TokenMissingError);
    assert.equal(
      access.message,
      "no token for globex is saved as teamrig-gh-globex in the test store; teamrig reaches a repository only with its owner's saved token, never the gh login: save one with: save teamrig-gh-globex",
    );
  });

  it('gives no access, never the gh login, when the store holds the key but cannot read it', async () => {
    const tokens = new RepoTokens(new FakeCredentials().failsOn('teamrig-gh-acme', 'the keyring is locked'), ENV);
    const access = await tokens.accessFor('acme/web');
    assert.ok(access instanceof TokenReadError);
    assert.equal(
      access.message,
      'could not read teamrig-gh-acme from the test store: the keyring is locked; unlock the store and rerun, or save the key again with: save teamrig-gh-acme',
    );
  });
});
