/**
 * The owner's proof adapters, one per operating system's gesture-held key (T4758 plan): Windows Hello, a Secure
 * Enclave key behind Touch ID, a root-owned key behind polkit, a FIDO2 key through OpenSSH, and none.
 */
export const OWNER_PROOF_ADAPTERS = ['windows-hello', 'touch-id', 'polkit', 'security-key', 'none'];
export function isOwnerProofAdapterId(value) {
    return OWNER_PROOF_ADAPTERS.some((id) => id === value);
}
/** The adapter for `none`: no key, so no owner-only act is ever proved and each one stays in the decision queue. */
export const NO_OWNER_PROOF = {
    id: 'none',
    available: () => Promise.resolve(false),
    enrol: () => Promise.resolve({ kind: 'unavailable', why: 'the owner proof adapter is none' }),
    sign: () => Promise.resolve({ kind: 'unavailable', why: 'the owner proof adapter is none' }),
};
