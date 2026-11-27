import type { OwnerProofChallenge } from './challenge-shape.ts';
import { isActId, type OwnerProofRecord } from './record.ts';

/** The record for the act a proof was spent on, its challenge and the signature bytes an adapter answered. */
export function ownerProofRecord(actId: string, challenge: OwnerProofChallenge, signature: Buffer): OwnerProofRecord {
  if (!isActId(actId)) {
    throw new Error(`an act id is a lowercase UUID, not "${actId}"`);
  }
  return { actId, challenge, signature: signature.toString('base64') };
}

/** The signature bytes a record holds. */
export function recordSignature(record: OwnerProofRecord): Buffer {
  return Buffer.from(record.signature, 'base64');
}
