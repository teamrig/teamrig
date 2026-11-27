import type { PinnedKey } from './pin.ts';

/**
 * The owner's proof adapters, one per operating system's gesture-held key (T4758 plan): Windows Hello, a Secure
 * Enclave key behind Touch ID, a root-owned key behind polkit, a FIDO2 key through OpenSSH, and none.
 */
export const OWNER_PROOF_ADAPTERS = ['windows-hello', 'touch-id', 'polkit', 'security-key', 'none'] as const;

export type OwnerProofAdapterId = (typeof OWNER_PROOF_ADAPTERS)[number];

export function isOwnerProofAdapterId(value: unknown): value is OwnerProofAdapterId {
  return OWNER_PROOF_ADAPTERS.some((id) => id === value);
}

export type EnrolOutcome =
  | { readonly kind: 'enrolled'; readonly key: PinnedKey }
  | { readonly kind: 'declined' }
  | { readonly kind: 'unavailable'; readonly why: string };

export type SignOutcome =
  | { readonly kind: 'signed'; readonly signature: Buffer }
  | { readonly kind: 'declined' }
  | { readonly kind: 'unavailable'; readonly why: string };

/**
 * A key that signs only after a gesture the operating system checked. `sign` takes the challenge digest only as 64
 * lowercase hex and answers `unavailable` for anything else before any prompt (T4758 security read, C5: checked on both sides).
 * An adapter not proved on its system answers `available()` false, so that system keeps the owner's decision queue.
 */
export interface OwnerProofAdapter {
  readonly id: OwnerProofAdapterId;
  available(): Promise<boolean>;
  /** Makes the key named keyId after a gesture, and answers its public key as the pin keeps it. */
  enrol(keyId: string): Promise<EnrolOutcome>;
  /** Signs the 32 bytes digestHex spells, after a gesture, with the key named keyId. */
  sign(keyId: string, digestHex: string): Promise<SignOutcome>;
}

/** The adapter for `none`: no key, so no owner-only act is ever proved and each one stays in the decision queue. */
export const NO_OWNER_PROOF: OwnerProofAdapter = {
  id: 'none',
  available: () => Promise.resolve(false),
  enrol: () => Promise.resolve({ kind: 'unavailable', why: 'the owner proof adapter is none' }),
  sign: () => Promise.resolve({ kind: 'unavailable', why: 'the owner proof adapter is none' }),
};

/** The adapter teamrig runs for the id `owner.proof.adapter` names. */
export type OwnerProofAdapters = (id: OwnerProofAdapterId) => OwnerProofAdapter;

/**
 * An adapter not yet proved on its system: it answers not ready, so a proof enrolled for it is turned down and each
 * owner-only act stays in the decision queue, never run unguarded.
 */
export function unprovedOwnerProof(id: OwnerProofAdapterId): OwnerProofAdapter {
  if (id === 'none') return NO_OWNER_PROOF;
  const why = `the ${id} owner proof adapter is not proved on this system yet`;
  return {
    id,
    available: () => Promise.resolve(false),
    enrol: () => Promise.resolve({ kind: 'unavailable', why }),
    sign: () => Promise.resolve({ kind: 'unavailable', why }),
  };
}
