import type { OwnerProofChallenge } from './challenge-shape.ts';
import type { OwnerProofRecord } from './record.ts';

/** The record for a challenge and the signature bytes an adapter answered. */
export function ownerProofRecord(challenge: OwnerProofChallenge, signature: Buffer): OwnerProofRecord {
  return { challenge, signature: signature.toString('base64') };
}

/** The signature bytes a record holds. */
export function recordSignature(record: OwnerProofRecord): Buffer {
  return Buffer.from(record.signature, 'base64');
}
