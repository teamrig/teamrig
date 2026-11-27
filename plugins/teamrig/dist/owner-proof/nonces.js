import { randomBytes } from 'node:crypto';
/** A fresh nonce: 32 random bytes as 64 lowercase hex digits. */
export function newNonce(random = randomBytes) {
    return random(32).toString('hex');
}
/** What the ledger knows of a nonce, for verifyProof. */
export function nonceState(entries, nonce) {
    const entry = entries.find((each) => each.nonce === nonce);
    if (entry === undefined)
        return { kind: 'unknown' };
    return entry.used ? { kind: 'used' } : { kind: 'issued', actDigest: entry.actDigest };
}
/** The ledger with a nonce issued for an act; refused (thrown) for a nonce it already holds, which a fresh one never is. */
export function issueNonce(entries, issued) {
    if (entries.some((each) => each.nonce === issued.nonce))
        throw new Error('the nonce was issued before');
    return [...entries, { ...issued, used: false }];
}
/**
 * The ledger with the nonce marked used, and whether this call used it: false when it was unknown or used already.
 * The caller writes the ledger back before the act runs, so a nonce is one use even when the act then fails
 * (T4758 security read, C3).
 */
export function useNonce(entries, nonce) {
    const entry = entries.find((each) => each.nonce === nonce);
    if (entry === undefined || entry.used)
        return { entries, used: false };
    return { entries: entries.map((each) => (each === entry ? { ...each, used: true } : each)), used: true };
}
/**
 * The ledger without entries expired before `now` less the grace: an expired nonce verifies as expired by its own
 * challenge, and once gone it verifies as unknown, refused either way.
 */
export function pruneNonces(entries, now, graceMs = 0) {
    return entries.filter((each) => each.expires + graceMs > now);
}
