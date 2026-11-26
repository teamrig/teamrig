import { isRecord, isStringArray, stringField, type JsonRecord } from '../core/guards.ts';

// No node: import here: the register's task lines keep a Decided's proof, and the read entry (src/read) reads them
// without Node's modules. Hashing the challenge lives in challenge.ts.

/** The domain tag every owner's proof challenge starts from, so a signature made for it signs nothing else. */
export const PROOF_DOMAIN = 'teamrig-owner-proof/v1';

const HEX_64 = /^[0-9a-f]{64}$/u;

/**
 * What the owner's key signs for one owner-only act (T4758 security read, C3): the key and host it is for, the
 * team, the act's exact argv, the commit and the decision card it names (null when it names none), a 32-byte nonce as
 * 64 lowercase hex, and when it was issued and expires, as ISO UTC instants.
 */
export interface OwnerProofChallenge {
  readonly domain: typeof PROOF_DOMAIN;
  readonly keyId: string;
  readonly hostId: string;
  readonly team: string;
  readonly act: readonly string[];
  readonly commit: string | null;
  readonly cardDigest: string | null;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expires: string;
}

/** True for 64 lowercase hex digits: a nonce, a challenge digest, the only form a challenge reaches an adapter in. */
export function isHex64(value: string): boolean {
  return HEX_64.test(value);
}

function nullableString(record: JsonRecord, key: string): string | null | undefined {
  const value = record[key];
  return value === null || typeof value === 'string' ? value : undefined;
}

/** A UTC instant as Date.toISOString writes it: the one form a challenge's times take. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The ms since the epoch of an ISO UTC instant, or undefined for any other text, a day past its month's end among them. */
export function instantOf(text: string): number | undefined {
  if (!ISO_UTC.test(text)) return undefined;
  const ms = Date.parse(text);
  return Number.isFinite(ms) && new Date(ms).toISOString() === text ? ms : undefined;
}

/** Whether a challenge's times are both ISO UTC instants, and it expires after it was issued. */
export function timesHold(issuedAt: string, expires: string): boolean {
  const issued = instantOf(issuedAt);
  const ends = instantOf(expires);
  return issued !== undefined && ends !== undefined && ends > issued;
}

/** The challenge a record holds, or undefined when any field is missing, of the wrong type, or not its form. */
export function parseChallenge(value: unknown): OwnerProofChallenge | undefined {
  if (!isRecord(value) || value['domain'] !== PROOF_DOMAIN) return undefined;
  const keyId = stringField(value, 'keyId');
  const hostId = stringField(value, 'hostId');
  const team = stringField(value, 'team');
  const act = value['act'];
  const commit = nullableString(value, 'commit');
  const cardDigest = nullableString(value, 'cardDigest');
  const nonce = stringField(value, 'nonce');
  const issuedAt = stringField(value, 'issuedAt');
  const expires = stringField(value, 'expires');
  if (keyId === undefined || hostId === undefined || team === undefined || !isStringArray(act)) return undefined;
  if (commit === undefined || cardDigest === undefined || nonce === undefined || !isHex64(nonce)) return undefined;
  if (issuedAt === undefined || expires === undefined || !timesHold(issuedAt, expires)) return undefined;
  return { domain: PROOF_DOMAIN, keyId, hostId, team, act, commit, cardDigest, nonce, issuedAt, expires };
}
