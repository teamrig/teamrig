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

describe('owner proof record', () => {
  it('keeps the signature as base64 and gives the same bytes back', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252]);
    const record = ownerProofRecord(challenge, bytes);
    assert.equal(record.signature, 'AAEC+vv8');
    assert.deepEqual(recordSignature(record), bytes);
  });

  it('reads back what it stored, through JSON', () => {
    const record = ownerProofRecord(challenge, Buffer.from('signed'));
    assert.deepEqual(parseOwnerProofRecord(JSON.parse(JSON.stringify(record))), record);
  });

  it('refuses a value that is not a record, a challenge it cannot read, or a signature that is not base64', () => {
    assert.equal(parseOwnerProofRecord('x'), 'ownerProof is not an object');
    assert.equal(parseOwnerProofRecord({ challenge: { ...challenge, nonce: 'short' }, signature: 'AAEC' }), 'ownerProof has no readable challenge');
    assert.equal(parseOwnerProofRecord({ challenge, signature: '' }), 'ownerProof has no base64 signature');
    assert.equal(parseOwnerProofRecord({ challenge, signature: 'not base64!' }), 'ownerProof has no base64 signature');
    assert.equal(parseOwnerProofRecord({ challenge }), 'ownerProof has no base64 signature');
  });
});
