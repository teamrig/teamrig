import { randomBytes } from 'node:crypto';
import type { NonceState } from './verify.ts';

/**
 * One nonce the ledger issued: the act it is for (actDigest), when it expires (ms since the epoch), and the act id
 * that spent it (the one its proof record holds), null while unused. The id lets an act check a recorded proof later:
 * the proof holds only for the one record that spent its nonce (T4758 security read, O4).
 */
export interface NonceEntry {
  readonly nonce: string;
  readonly actDigest: string;
  readonly expires: number;
  readonly spentBy: string | null;
}

/** A fresh nonce: 32 random bytes as 64 lowercase hex digits. */
export function newNonce(random: (size: number) => Buffer = randomBytes): string {
  return random(32).toString('hex');
}

/** What the ledger knows of a nonce, for verifyProof and verifyRecordedProof. */
export function nonceState(entries: readonly NonceEntry[], nonce: string): NonceState {
  const entry = entries.find((each) => each.nonce === nonce);
  if (entry === undefined) return { kind: 'unknown' };
  if (entry.spentBy === null) return { kind: 'issued', actDigest: entry.actDigest };
  return { kind: 'used', actDigest: entry.actDigest, spentBy: entry.spentBy };
}

/** The ledger with a nonce issued for an act; refused (thrown) for a nonce it already holds, which a fresh one never is. */
export function issueNonce(entries: readonly NonceEntry[], issued: Omit<NonceEntry, 'spentBy'>): readonly NonceEntry[] {
  if (entries.some((each) => each.nonce === issued.nonce)) throw new Error('the nonce was issued before');
  return [...entries, { ...issued, spentBy: null }];
}

/**
 * The ledger with the nonce spent by the given act id, and whether this call spent it: false when it was
 * unknown or spent already. The caller writes the ledger back before the act runs, so a nonce is one use even when
 * the act then fails (T4758 security read, C3).
 */
export function useNonce(
  entries: readonly NonceEntry[],
  nonce: string,
  spentBy: string,
): { readonly entries: readonly NonceEntry[]; readonly used: boolean } {
  if (spentBy.length === 0) throw new Error('a nonce is spent by an act id, never an empty one');
  const entry = entries.find((each) => each.nonce === nonce);
  if (entry === undefined || entry.spentBy !== null) return { entries, used: false };
  return { entries: entries.map((each) => (each === entry ? { ...each, spentBy } : each)), used: true };
}

/**
 * The ledger without unused entries expired before `now` less the grace: an expired nonce verifies as expired by its
 * own challenge, and once gone it verifies as unknown, refused either way. A spent entry stays, since the act its
 * Decided event approved checks the recorded proof against it when it runs, which may be long after the expiry.
 */
export function pruneNonces(entries: readonly NonceEntry[], now: number, graceMs = 0): readonly NonceEntry[] {
  return entries.filter((each) => each.spentBy !== null || each.expires + graceMs > now);
}
