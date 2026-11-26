/**
 * The signature schemes a pinned key may use. The verifier takes the one stored with the pin, never one a proof record
 * names (T4758 security read, C3). rsa-pkcs1-sha256 is Windows Hello's KeyCredential; ecdsa-p256-sha256 a Secure Enclave key;
 * ed25519 a key a root-owned helper holds.
 */
export const SIGNATURE_ALGORITHMS = ['rsa-pkcs1-sha256', 'ecdsa-p256-sha256', 'ed25519'] as const;

export type SignatureAlgorithm = (typeof SIGNATURE_ALGORITHMS)[number];

export function isSignatureAlgorithm(value: unknown): value is SignatureAlgorithm {
  return SIGNATURE_ALGORITHMS.some((algorithm) => algorithm === value);
}

/** The owner's enrolled public key as the pin keeps it. */
export interface PinnedKey {
  readonly keyId: string;
  readonly algorithm: SignatureAlgorithm;
  readonly publicKeyPem: string;
}
