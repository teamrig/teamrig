import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FakeCredentials } from '../testing/fake-credentials.ts';
import { pickKey, type KeyCandidate } from './key-pick.ts';

const REPO: KeyCandidate = { scope: 'acme/web', credential: 'key-acme.web' };
const OWNER: KeyCandidate = { scope: 'acme', credential: 'key-acme' };

describe('pickKey', () => {
  it('gives the narrowest saved key, reading no wider one', async () => {
    const store = new FakeCredentials().saves('key-acme.web', 'repo-key').saves('key-acme', 'owner-key');
    assert.deepEqual(await pickKey(store, [REPO, OWNER]), { kind: 'found', secret: 'repo-key', scope: 'acme/web', credential: 'key-acme.web' });
    assert.deepEqual(store.reads, ['key-acme.web']);
  });

  it('gives the wider key when no narrower one is saved', async () => {
    const store = new FakeCredentials().saves('key-acme', 'owner-key');
    assert.deepEqual(await pickKey(store, [REPO, OWNER]), { kind: 'found', secret: 'owner-key', scope: 'acme', credential: 'key-acme' });
    assert.deepEqual(store.reads, ['key-acme.web', 'key-acme']);
  });

  it('stops at a narrower key the store could not read, never taking the wider one', async () => {
    const store = new FakeCredentials().failsOn('key-acme.web', 'the keyring is locked').saves('key-acme', 'owner-key');
    assert.deepEqual(await pickKey(store, [REPO, OWNER]), { kind: 'failed', scope: 'acme/web', credential: 'key-acme.web', reason: 'the keyring is locked' });
    assert.deepEqual(store.reads, ['key-acme.web']);
  });

  it('says every credential it tried when none is saved', async () => {
    assert.deepEqual(await pickKey(new FakeCredentials(), [REPO, OWNER]), { kind: 'missing', tried: [REPO, OWNER] });
  });
});
