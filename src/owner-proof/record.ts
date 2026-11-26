import { isRecord, stringField } from '../core/guards.ts';
import { parseChallenge, type OwnerProofChallenge } from './challenge-shape.ts';

// No node: import or Buffer here, as in challenge-shape.ts: task lines read this record in the read entry too. The
// signature's bytes are made and read in record-bytes.ts.

/** Standard base64 with its padding: the only form a stored signature takes. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/**
 * The owner's proof as an act's record keeps it (T4758 C1): the challenge the owner's key signed, whole, and the
 * signature as base64. It names its key only through the challenge, so a check always reads the key it verifies by
 * from the pins, never from the record.
 */
export interface OwnerProofRecord {
  readonly challenge: OwnerProofChallenge;
  readonly signature: string;
}

/** The record a stored value holds, or why it is not one. */
export function parseOwnerProofRecord(value: unknown): OwnerProofRecord | string {
  if (!isRecord(value)) {
    return 'ownerProof is not an object';
  }
  const challenge = parseChallenge(value['challenge']);
  if (challenge === undefined) {
    return 'ownerProof has no readable challenge';
  }
  const signature = stringField(value, 'signature');
  if (signature === undefined || signature.length === 0 || !BASE64.test(signature)) {
    return 'ownerProof has no base64 signature';
  }
  return { challenge, signature };
}
