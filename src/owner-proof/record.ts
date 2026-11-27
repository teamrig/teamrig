import { isRecord, stringField } from '../core/guards.ts';
import { parseChallenge, type OwnerProofChallenge } from './challenge-shape.ts';

// No node: import or Buffer here, as in challenge-shape.ts: task lines read this record in the read entry too. The
// signature's bytes are made and read in record-bytes.ts.

/** Standard base64 with its padding: the only form a stored signature takes. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/** A lowercase UUID, as randomUUID writes it: the only form an act id takes. */
const ACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * The owner's proof as an act's record keeps it (T4758 C1): the id of the act it was spent on, the challenge the
 * owner's key signed, whole, and the signature as base64. The nonce ledger names the act id as what spent the
 * challenge's nonce, since register events have no id of their own and an event's `at` is stamped after the nonce
 * is spent. It names its key only through the challenge, so a check always reads the key it verifies by from the
 * pins, never from the record.
 */
export interface OwnerProofRecord {
  readonly actId: string;
  readonly challenge: OwnerProofChallenge;
  readonly signature: string;
}

/** True for a lowercase UUID: the act id a proof record names. */
export function isActId(value: string): boolean {
  return ACT_ID.test(value);
}

/** The record a stored value holds, or why it is not one. */
export function parseOwnerProofRecord(value: unknown): OwnerProofRecord | string {
  if (!isRecord(value)) {
    return 'ownerProof is not an object';
  }
  const actId = stringField(value, 'actId');
  if (actId === undefined || !isActId(actId)) {
    return 'ownerProof has no act id (a lowercase UUID)';
  }
  const challenge = parseChallenge(value['challenge']);
  if (challenge === undefined) {
    return 'ownerProof has no readable challenge';
  }
  const signature = stringField(value, 'signature');
  if (signature === undefined || signature.length === 0 || !BASE64.test(signature)) {
    return 'ownerProof has no base64 signature';
  }
  return { actId, challenge, signature };
}
