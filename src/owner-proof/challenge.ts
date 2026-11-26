import { createHash } from 'node:crypto';
import type { OwnerProofChallenge } from './challenge-shape.ts';
import { jcs } from './jcs.ts';

/** The challenge's RFC 8785 canonical JSON: the text whose bytes are hashed. */
export function challengeText(challenge: OwnerProofChallenge): string {
  return jcs({
    domain: challenge.domain,
    keyId: challenge.keyId,
    hostId: challenge.hostId,
    team: challenge.team,
    act: challenge.act,
    commit: challenge.commit,
    cardDigest: challenge.cardDigest,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    expires: challenge.expires,
  });
}

/**
 * The bytes every adapter signs: the SHA-256 of the canonical JSON's UTF-8 bytes, 32 bytes. Windows Hello's
 * KeyCredential then signs this buffer with RSA-2048 PKCS#1 v1.5 over its SHA-256, and the verifier checks exactly
 * that, so no adapter ever sees the JSON itself.
 */
export function challengeDigest(challenge: OwnerProofChallenge): Buffer {
  return createHash('sha256').update(challengeText(challenge), 'utf8').digest();
}

/** The digest as 64 lowercase hex digits, the only form a challenge is handed to an adapter's signer in. */
export function challengeHex(challenge: OwnerProofChallenge): string {
  return challengeDigest(challenge).toString('hex');
}
