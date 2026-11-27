import { PROOF_DOMAIN } from '../owner-proof/challenge-shape.ts';
import type { OwnerProofRecord } from '../owner-proof/record.ts';

/** A stored proof record in form, for specs that keep or read one; its signature verifies by no key. */
export const OWNER_PROOF_RECORD: OwnerProofRecord = {
  challenge: {
    domain: PROOF_DOMAIN,
    keyId: 'key-1',
    hostId: 'host-1',
    team: 'alpha',
    act: ['owner', 'decide', 'alpha/T1', '--approve'],
    commit: null,
    cardDigest: 'c'.repeat(64),
    nonce: 'a'.repeat(64),
    issuedAt: '2030-01-08T11:00:00.000Z',
    expires: '2030-01-08T11:05:00.000Z',
  },
  signature: 'c2lnbmF0dXJl',
};
