import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { challengeDigest, instantOf, type OwnerProofChallenge } from './challenge.ts';
import { jcs } from './jcs.ts';
import type { PinnedKey, SignatureAlgorithm } from './pin.ts';

/** The act a proof must be for: what teamrig is about to run, from its own state, never from the proof. */
export interface ActBinding {
  readonly team: string;
  readonly hostId: string;
  readonly act: readonly string[];
  readonly commit: string | null;
  readonly cardDigest: string | null;
}

/** What the nonce ledger knows of a challenge's nonce: never issued, already used, or issued for an act (its digest). */
export type NonceState = { readonly kind: 'unknown' } | { readonly kind: 'used' } | { readonly kind: 'issued'; readonly actDigest: string };

/** Why a proof is refused. */
export type ProofRefusal =
  | 'unknown-key'
  | 'other-act'
  | 'nonce-unknown'
  | 'nonce-used'
  | 'nonce-other-act'
  | 'expired'
  | 'issued-in-future'
  | 'lifetime-too-long'
  | 'bad-times'
  | 'bad-signature';

export type ProofVerdict = { readonly ok: true; readonly keyId: string } | { readonly ok: false; readonly reason: ProofRefusal };

export interface ProofCheck {
  readonly challenge: OwnerProofChallenge;
  readonly signature: Buffer;
  readonly pins: readonly PinnedKey[];
  readonly expected: ActBinding;
  readonly nonce: NonceState;
  /** Now, in ms since the epoch. */
  readonly now: number;
}

/** How far ahead of this clock a challenge's issuedAt may be, for a signer whose clock runs a little fast. */
export const ISSUED_AT_SKEW_MS = 30_000;

/** The longest a challenge may live (owner.proof.ttlSeconds' ceiling). */
export const MAX_LIFETIME_MS = 600_000;

/** The SHA-256 hex of an act binding's canonical JSON: what the nonce ledger keeps for the act a nonce was issued for. */
export function actDigest(binding: ActBinding): string {
  const text = jcs({
    team: binding.team,
    hostId: binding.hostId,
    act: binding.act,
    commit: binding.commit,
    cardDigest: binding.cardDigest,
  });
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function sameAct(challenge: OwnerProofChallenge, expected: ActBinding): boolean {
  return actDigest(challenge) === actDigest(expected);
}

function publicKey(pem: string): KeyObject | undefined {
  try {
    return createPublicKey(pem);
  } catch {
    return undefined;
  }
}

/** The key type and, for EC, the curve each algorithm's key must be. */
function keyFits(key: KeyObject, algorithm: SignatureAlgorithm): boolean {
  switch (algorithm) {
    case 'rsa-pkcs1-sha256':
      return key.asymmetricKeyType === 'rsa';
    case 'ecdsa-p256-sha256':
      return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
    case 'ed25519':
      return key.asymmetricKeyType === 'ed25519';
  }
}

function signatureHolds(pin: PinnedKey, data: Buffer, signature: Buffer): boolean {
  const key = publicKey(pin.publicKeyPem);
  if (key === undefined || !keyFits(key, pin.algorithm)) return false;
  try {
    switch (pin.algorithm) {
      case 'rsa-pkcs1-sha256':
        return verify('sha256', data, key, signature);
      case 'ecdsa-p256-sha256':
        return verify('sha256', data, { key, dsaEncoding: 'der' }, signature);
      case 'ed25519':
        return verify(null, data, key, signature);
    }
  } catch {
    return false;
  }
}

/**
 * Why the challenge's times refuse it, if they do. A time out of form or a lifetime of zero or less refuses it here
 * too, not only in parseChallenge, so a challenge built in code fails closed: NaN would pass every compare below.
 */
function timeRefusal(challenge: OwnerProofChallenge, now: number): ProofRefusal | undefined {
  const issuedAt = instantOf(challenge.issuedAt);
  const expires = instantOf(challenge.expires);
  if (issuedAt === undefined || expires === undefined || expires <= issuedAt || !Number.isFinite(now)) return 'bad-times';
  if (issuedAt > now + ISSUED_AT_SKEW_MS) return 'issued-in-future';
  if (expires - issuedAt > MAX_LIFETIME_MS) return 'lifetime-too-long';
  return now >= expires ? 'expired' : undefined;
}

function nonceRefusal(nonce: NonceState, expected: ActBinding): ProofRefusal | undefined {
  if (nonce.kind === 'unknown') return 'nonce-unknown';
  if (nonce.kind === 'used') return 'nonce-used';
  return nonce.actDigest === actDigest(expected) ? undefined : 'nonce-other-act';
}

/**
 * Whether a signed challenge proves the owner approved exactly the act teamrig is about to run (T4758 security read, C3):
 * the key is a pinned one, verified by the pin's own algorithm; the challenge names the expected act; its nonce was
 * issued for that act and is unused; it is neither expired, issued in the future past the skew, nor longer lived than
 * the ceiling; and the signature over the challenge digest holds. The caller marks the nonce used before the act runs.
 */
export function verifyProof(check: ProofCheck): ProofVerdict {
  const pin = check.pins.find((candidate) => candidate.keyId === check.challenge.keyId);
  if (pin === undefined) return { ok: false, reason: 'unknown-key' };
  if (!sameAct(check.challenge, check.expected)) return { ok: false, reason: 'other-act' };
  const refusal = nonceRefusal(check.nonce, check.expected) ?? timeRefusal(check.challenge, check.now);
  if (refusal !== undefined) return { ok: false, reason: refusal };
  if (!signatureHolds(pin, challengeDigest(check.challenge), check.signature)) return { ok: false, reason: 'bad-signature' };
  return { ok: true, keyId: pin.keyId };
}
