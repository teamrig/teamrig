import type { CredentialStore } from './credentials.ts';

/**
 * Which saved key reaches a target (T4897 S4), provider-neutral: a connector names the credentials that could hold a
 * key for the target, the narrowest scope first (one repository, then its owner), and the first one saved wins. The
 * scope lives in the credential's own name, never in an editable config, so only a person saving or removing a key
 * changes which key reaches what.
 */

/** One credential that may hold a key for the target, and the scope it covers, as a message names it. */
export interface KeyCandidate {
  readonly scope: string;
  readonly credential: string;
}

/** What the pick found: the key and where it came from, or why no key reaches the target. */
export type KeyPick =
  | { readonly kind: 'found'; readonly secret: string; readonly scope: string; readonly credential: string }
  | { readonly kind: 'missing'; readonly tried: readonly KeyCandidate[] }
  | { readonly kind: 'failed'; readonly scope: string; readonly credential: string; readonly reason: string };

/**
 * Reads the candidates in order and gives the first key saved. A read that fails stops the pick there: a wider key
 * never stands in for a narrower one the store holds but could not read, which may be the one with fewer rights.
 */
export async function pickKey(store: Pick<CredentialStore, 'read'>, candidates: readonly KeyCandidate[]): Promise<KeyPick> {
  for (const candidate of candidates) {
    const read = await store.read(candidate.credential);
    switch (read.kind) {
      case 'found':
        return { kind: 'found', secret: read.secret, scope: candidate.scope, credential: candidate.credential };
      case 'failed':
        return { kind: 'failed', scope: candidate.scope, credential: candidate.credential, reason: read.reason };
      case 'missing':
        break;
    }
  }
  return { kind: 'missing', tried: candidates };
}
