import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PROOF_DOMAIN, type OwnerProofChallenge } from './challenge-shape.ts';
import { ownerProofRecord, recordSignature } from './record-bytes.ts';
import { parseOwnerProofRecord } from './record.ts';

const challenge: OwnerProofChallenge = {
  domain: PROOF_DOMAIN,
  keyId: 'key-1',
  hostId: 'host-1',
  team: 'alpha',
  act: ['owner', 'decide', 'alpha/T12', '--approve'],
  commit: null,
  cardDigest: 'c'.repeat(64),
  nonce: 'a'.repeat(64),
  issuedAt: '2026-11-26T07:00:00.000Z',
  expires: '2026-11-26T07:05:00.000Z',
};

const ACT_ID = '6f1c2b0e-4a5d-4e8f-9b3a-1c2d3e4f5a6b';

describe('owner proof record', () => {
  it('keeps the act id and the signature as base64, and gives the same bytes back', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252]);
    const record = ownerProofRecord(ACT_ID, challenge, bytes);
    assert.equal(record.actId, ACT_ID);
    assert.equal(record.signature, 'AAEC+vv8');
    assert.deepEqual(recordSignature(record), bytes);
  });

  it('reads back what it stored, through JSON', () => {
    const record = ownerProofRecord(ACT_ID, challenge, Buffer.from('signed'));
    assert.deepEqual(parseOwnerProofRecord(JSON.parse(JSON.stringify(record))), record);
  });

  it('makes no record for an act id that is not a lowercase UUID', () => {
    assert.throws(() => ownerProofRecord(ACT_ID.toUpperCase(), challenge, Buffer.from('signed')), /lowercase UUID/);
    assert.throws(() => ownerProofRecord('ev-1', challenge, Buffer.from('signed')), /lowercase UUID/);
  });

  it('refuses a value that is not a record, an act id, a challenge it cannot read, or a signature that is not base64', () => {
    assert.equal(parseOwnerProofRecord('x'), 'ownerProof is not an object');
    assert.equal(parseOwnerProofRecord({ challenge, signature: 'AAEC' }), 'ownerProof has no act id (a lowercase UUID)');
    assert.equal(parseOwnerProofRecord({ actId: 'T12', challenge, signature: 'AAEC' }), 'ownerProof has no act id (a lowercase UUID)');
    assert.equal(parseOwnerProofRecord({ actId: ACT_ID, challenge: { ...challenge, nonce: 'short' }, signature: 'AAEC' }), 'ownerProof has no readable challenge');
    assert.equal(parseOwnerProofRecord({ actId: ACT_ID, challenge, signature: '' }), 'ownerProof has no base64 signature');
    assert.equal(parseOwnerProofRecord({ actId: ACT_ID, challenge, signature: 'not base64!' }), 'ownerProof has no base64 signature');
    assert.equal(parseOwnerProofRecord({ actId: ACT_ID, challenge }), 'ownerProof has no base64 signature');
  });
});
