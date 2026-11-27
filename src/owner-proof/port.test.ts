import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fakeOwnerProof } from '../testing/fake-owner-proof.ts';
import { describeOwnerProofContract } from '../testing/owner-proof-contract.ts';
import { NO_OWNER_PROOF, OWNER_PROOF_ADAPTERS, isOwnerProofAdapterId } from './port.ts';

describeOwnerProofContract('the fake owner proof', (world) => fakeOwnerProof(world));

describe('the none adapter', () => {
  it('is never available, and neither enrols nor signs', async () => {
    assert.equal(NO_OWNER_PROOF.id, 'none');
    assert.equal(await NO_OWNER_PROOF.available(), false);
    assert.equal((await NO_OWNER_PROOF.enrol('teamrig-owner')).kind, 'unavailable');
    assert.equal((await NO_OWNER_PROOF.sign('teamrig-owner', 'a'.repeat(64))).kind, 'unavailable');
  });
});

describe('isOwnerProofAdapterId', () => {
  it('takes each listed adapter and refuses anything else', () => {
    for (const id of OWNER_PROOF_ADAPTERS) assert.equal(isOwnerProofAdapterId(id), true);
    for (const other of ['hello', 'None', 0, null]) assert.equal(isOwnerProofAdapterId(other), false);
  });
});
