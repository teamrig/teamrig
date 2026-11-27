import { createHash } from 'node:crypto';
import { isRecord, isStringArray, stringField } from "../core/guards.js";
import { jcs } from "./jcs.js";
/** The domain tag every owner's proof challenge starts from, so a signature made for it signs nothing else. */
export const PROOF_DOMAIN = 'teamrig-owner-proof/v1';
const HEX_64 = /^[0-9a-f]{64}$/u;
/** True for 64 lowercase hex digits: a nonce, a challenge digest, the only form a challenge reaches an adapter in. */
export function isHex64(value) {
    return HEX_64.test(value);
}
/** The challenge's RFC 8785 canonical JSON: the text whose bytes are hashed. */
export function challengeText(challenge) {
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
export function challengeDigest(challenge) {
    return createHash('sha256').update(challengeText(challenge), 'utf8').digest();
}
/** The digest as 64 lowercase hex digits, the only form a challenge is handed to an adapter's signer in. */
export function challengeHex(challenge) {
    return challengeDigest(challenge).toString('hex');
}
function nullableString(record, key) {
    const value = record[key];
    return value === null || typeof value === 'string' ? value : undefined;
}
/** A UTC instant as Date.toISOString writes it: the one form a challenge's times take. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** The ms since the epoch of an ISO UTC instant, or undefined for any other text, a day past its month's end among them. */
export function instantOf(text) {
    if (!ISO_UTC.test(text))
        return undefined;
    const ms = Date.parse(text);
    return Number.isFinite(ms) && new Date(ms).toISOString() === text ? ms : undefined;
}
/** Whether a challenge's times are both ISO UTC instants, and it expires after it was issued. */
export function timesHold(issuedAt, expires) {
    const issued = instantOf(issuedAt);
    const ends = instantOf(expires);
    return issued !== undefined && ends !== undefined && ends > issued;
}
/** The challenge a record holds, or undefined when any field is missing, of the wrong type, or not its form. */
export function parseChallenge(value) {
    if (!isRecord(value) || value['domain'] !== PROOF_DOMAIN)
        return undefined;
    const keyId = stringField(value, 'keyId');
    const hostId = stringField(value, 'hostId');
    const team = stringField(value, 'team');
    const act = value['act'];
    const commit = nullableString(value, 'commit');
    const cardDigest = nullableString(value, 'cardDigest');
    const nonce = stringField(value, 'nonce');
    const issuedAt = stringField(value, 'issuedAt');
    const expires = stringField(value, 'expires');
    if (keyId === undefined || hostId === undefined || team === undefined || !isStringArray(act))
        return undefined;
    if (commit === undefined || cardDigest === undefined || nonce === undefined || !isHex64(nonce))
        return undefined;
    if (issuedAt === undefined || expires === undefined || !timesHold(issuedAt, expires))
        return undefined;
    return { domain: PROOF_DOMAIN, keyId, hostId, team, act, commit, cardDigest, nonce, issuedAt, expires };
}
