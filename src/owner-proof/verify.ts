import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { challengeDigest } from './challenge.ts';
import { instantOf, type OwnerProofChallenge } from './challenge-shape.ts';
import { jcs } from './jcs.ts';
import { RSA_MIN_MODULUS_BITS, type PinnedKey, type SignatureAlgorithm } from './pin.ts';

/** The act a proof must be for: what teamrig is about to run, from its own state, never from the proof. */
export interface ActBinding {
  readonly team: string;
  readonly hostId: string;
  readonly act: readonly string[];
  readonly commit: string | null;
  readonly cardDigest: string | null;
}

/**
 * What the nonce ledger knows of a challenge's nonce: never issued, issued for an act (its digest) and unused, or
 * used, with the id of the register event that spent it.
 */
export type NonceState =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'issued'; readonly actDigest: string }
  | { readonly kind: 'used'; readonly actDigest: string; readonly spentBy: string };

/** Why a proof is refused. */
export type ProofRefusal =
  | 'unknown-key'
  | 'other-act'
  | 'nonce-unknown'
  | 'nonce-used'
  | 'nonce-unspent'
  | 'nonce-spent-by-other'
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

/** The key type, for EC the curve and for RSA the smallest modulus each algorithm's key must have. */
function keyFits(key: KeyObject, algorithm: SignatureAlgorithm): boolean {
  switch (algorithm) {
    case 'rsa-pkcs1-sha256':
      return key.asymmetricKeyType === 'rsa' && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= RSA_MIN_MODULUS_BITS;
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

/** A challenge's times as instants, once both are in form and it expires after it was issued. */
interface Lifetime {
  readonly issuedAt: number;
  readonly expires: number;
}

/**
 * The challenge's lifetime, or why its times refuse it whatever the clock reads. A time out of form or a lifetime of
 * zero or less refuses it here too, not only in parseChallenge, so a challenge built in code fails closed: NaN would
 * pass every compare.
 */
function lifetimeOf(challenge: OwnerProofChallenge): Lifetime | ProofRefusal {
  const issuedAt = instantOf(challenge.issuedAt);
  const expires = instantOf(challenge.expires);
  if (issuedAt === undefined || expires === undefined || expires <= issuedAt) return 'bad-times';
  return expires - issuedAt > MAX_LIFETIME_MS ? 'lifetime-too-long' : { issuedAt, expires };
}

/** Why the challenge's times refuse it now, if they do: lifetimeOf's refusals, then a future issuedAt or an expiry. */
function timeRefusal(challenge: OwnerProofChallenge, now: number): ProofRefusal | undefined {
  const lifetime = lifetimeOf(challenge);
  if (typeof lifetime === 'string') return lifetime;
  if (!Number.isFinite(now)) return 'bad-times';
  if (lifetime.issuedAt > now + ISSUED_AT_SKEW_MS) return 'issued-in-future';
  return now >= lifetime.expires ? 'expired' : undefined;
}

function nonceRefusal(nonce: NonceState, expected: ActBinding): ProofRefusal | undefined {
  if (nonce.kind === 'unknown') return 'nonce-unknown';
  if (nonce.kind === 'used') return 'nonce-used';
  return nonce.actDigest === actDigest(expected) ? undefined : 'nonce-other-act';
}

/** Why a recorded proof's nonce refuses it: it must have been spent, for this act, by this one Decided event. */
function spentRefusal(nonce: NonceState, expected: ActBinding, decidedId: string): ProofRefusal | undefined {
  if (nonce.kind === 'unknown') return 'nonce-unknown';
  if (nonce.kind === 'issued') return 'nonce-unspent';
  if (nonce.actDigest !== actDigest(expected)) return 'nonce-other-act';
  return nonce.spentBy === decidedId ? undefined : 'nonce-spent-by-other';
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

/** A proof a Decided event recorded, checked again when the act it approved runs. */
export interface RecordedProofCheck {
  readonly challenge: OwnerProofChallenge;
  readonly signature: Buffer;
  readonly pins: readonly PinnedKey[];
  /** Rebuilt from the act about to run (its argv, the card, the head it will merge or deploy), never from the event. */
  readonly expected: ActBinding;
  /** The ledger's state of the challenge's nonce, read without spending it. */
  readonly nonce: NonceState;
  /** The id of the Decided event that recorded the proof. */
  readonly decidedId: string;
}

/**
 * Whether a proof a Decided event recorded still approves the act about to run (T4758 security read, O4): the key is
 * pinned and verified by the pin's algorithm; the challenge names this act; its nonce was spent, for this act, by
 * this Decided event and no other, so one signature never serves a second event or another task; its times are in
 * form and within the lifetime ceiling; and the signature holds. Expiry is not checked: the act may run long after
 * the owner signed. This is its own check, never verifyProof with the nonce check turned off.
 */
export function verifyRecordedProof(check: RecordedProofCheck): ProofVerdict {
  const pin = check.pins.find((candidate) => candidate.keyId === check.challenge.keyId);
  if (pin === undefined) return { ok: false, reason: 'unknown-key' };
  if (!sameAct(check.challenge, check.expected)) return { ok: false, reason: 'other-act' };
  const lifetime = lifetimeOf(check.challenge);
  const refusal = spentRefusal(check.nonce, check.expected, check.decidedId) ?? (typeof lifetime === 'string' ? lifetime : undefined);
  if (refusal !== undefined) return { ok: false, reason: refusal };
  if (!signatureHolds(pin, challengeDigest(check.challenge), check.signature)) return { ok: false, reason: 'bad-signature' };
  return { ok: true, keyId: pin.keyId };
}
