import { randomBytes } from 'node:crypto';
import type { NonceState } from './verify.ts';

/** One nonce the ledger issued: the act it is for (actDigest), when it expires (ms since the epoch), whether it was used. */
export interface NonceEntry {
  readonly nonce: string;
  readonly actDigest: string;
  readonly expires: number;
  readonly used: boolean;
}

/** A fresh nonce: 32 random bytes as 64 lowercase hex digits. */
export function newNonce(random: (size: number) => Buffer = randomBytes): string {
  return random(32).toString('hex');
}

/** What the ledger knows of a nonce, for verifyProof. */
export function nonceState(entries: readonly NonceEntry[], nonce: string): NonceState {
  const entry = entries.find((each) => each.nonce === nonce);
  if (entry === undefined) return { kind: 'unknown' };
  return entry.used ? { kind: 'used' } : { kind: 'issued', actDigest: entry.actDigest };
}

/** The ledger with a nonce issued for an act; refused (thrown) for a nonce it already holds, which a fresh one never is. */
export function issueNonce(entries: readonly NonceEntry[], issued: Omit<NonceEntry, 'used'>): readonly NonceEntry[] {
  if (entries.some((each) => each.nonce === issued.nonce)) throw new Error('the nonce was issued before');
  return [...entries, { ...issued, used: false }];
}

/**
 * The ledger with the nonce marked used, and whether this call used it: false when it was unknown or used already.
 * The caller writes the ledger back before the act runs, so a nonce is one use even when the act then fails
 * (T4758 security read, C3).
 */
export function useNonce(entries: readonly NonceEntry[], nonce: string): { readonly entries: readonly NonceEntry[]; readonly used: boolean } {
  const entry = entries.find((each) => each.nonce === nonce);
  if (entry === undefined || entry.used) return { entries, used: false };
  return { entries: entries.map((each) => (each === entry ? { ...each, used: true } : each)), used: true };
}

/**
 * The ledger without entries expired before `now` less the grace: an expired nonce verifies as expired by its own
 * challenge, and once gone it verifies as unknown, refused either way.
 */
export function pruneNonces(entries: readonly NonceEntry[], now: number, graceMs = 0): readonly NonceEntry[] {
  return entries.filter((each) => each.expires + graceMs > now);
}
