import { createHash, createPublicKey, verify } from 'node:crypto';
import { challengeDigest, instantOf } from "./challenge.js";
import { jcs } from "./jcs.js";
import { RSA_MIN_MODULUS_BITS } from "./pin.js";
/** How far ahead of this clock a challenge's issuedAt may be, for a signer whose clock runs a little fast. */
export const ISSUED_AT_SKEW_MS = 30_000;
/** The longest a challenge may live (owner.proof.ttlSeconds' ceiling). */
export const MAX_LIFETIME_MS = 600_000;
/** The SHA-256 hex of an act binding's canonical JSON: what the nonce ledger keeps for the act a nonce was issued for. */
export function actDigest(binding) {
    const text = jcs({
        team: binding.team,
        hostId: binding.hostId,
        act: binding.act,
        commit: binding.commit,
        cardDigest: binding.cardDigest,
    });
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
function sameAct(challenge, expected) {
    return actDigest(challenge) === actDigest(expected);
}
function publicKey(pem) {
    try {
        return createPublicKey(pem);
    }
    catch {
        return undefined;
    }
}
/** The key type, for EC the curve and for RSA the smallest modulus each algorithm's key must have. */
function keyFits(key, algorithm) {
    switch (algorithm) {
        case 'rsa-pkcs1-sha256':
            return key.asymmetricKeyType === 'rsa' && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= RSA_MIN_MODULUS_BITS;
        case 'ecdsa-p256-sha256':
            return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
        case 'ed25519':
            return key.asymmetricKeyType === 'ed25519';
    }
}
function signatureHolds(pin, data, signature) {
    const key = publicKey(pin.publicKeyPem);
    if (key === undefined || !keyFits(key, pin.algorithm))
        return false;
    try {
        switch (pin.algorithm) {
            case 'rsa-pkcs1-sha256':
                return verify('sha256', data, key, signature);
            case 'ecdsa-p256-sha256':
                return verify('sha256', data, { key, dsaEncoding: 'der' }, signature);
            case 'ed25519':
                return verify(null, data, key, signature);
        }
    }
    catch {
        return false;
    }
}
/**
 * Why the challenge's times refuse it, if they do. A time out of form or a lifetime of zero or less refuses it here
 * too, not only in parseChallenge, so a challenge built in code fails closed: NaN would pass every compare below.
 */
function timeRefusal(challenge, now) {
    const issuedAt = instantOf(challenge.issuedAt);
    const expires = instantOf(challenge.expires);
    if (issuedAt === undefined || expires === undefined || expires <= issuedAt || !Number.isFinite(now))
        return 'bad-times';
    if (issuedAt > now + ISSUED_AT_SKEW_MS)
        return 'issued-in-future';
    if (expires - issuedAt > MAX_LIFETIME_MS)
        return 'lifetime-too-long';
    return now >= expires ? 'expired' : undefined;
}
function nonceRefusal(nonce, expected) {
    if (nonce.kind === 'unknown')
        return 'nonce-unknown';
    if (nonce.kind === 'used')
        return 'nonce-used';
    return nonce.actDigest === actDigest(expected) ? undefined : 'nonce-other-act';
}
/**
 * Whether a signed challenge proves the owner approved exactly the act teamrig is about to run (T4758 security read, C3):
 * the key is a pinned one, verified by the pin's own algorithm; the challenge names the expected act; its nonce was
 * issued for that act and is unused; it is neither expired, issued in the future past the skew, nor longer lived than
 * the ceiling; and the signature over the challenge digest holds. The caller marks the nonce used before the act runs.
 */
export function verifyProof(check) {
    const pin = check.pins.find((candidate) => candidate.keyId === check.challenge.keyId);
    if (pin === undefined)
        return { ok: false, reason: 'unknown-key' };
    if (!sameAct(check.challenge, check.expected))
        return { ok: false, reason: 'other-act' };
    const refusal = nonceRefusal(check.nonce, check.expected) ?? timeRefusal(check.challenge, check.now);
    if (refusal !== undefined)
        return { ok: false, reason: refusal };
    if (!signatureHolds(pin, challengeDigest(check.challenge), check.signature))
        return { ok: false, reason: 'bad-signature' };
    return { ok: true, keyId: pin.keyId };
}
