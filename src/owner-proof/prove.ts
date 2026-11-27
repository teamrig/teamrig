import { randomUUID } from 'node:crypto';
import type { Clock } from '../core/lock.ts';
import { challengeHex } from './challenge.ts';
import { PROOF_DOMAIN, type OwnerProofChallenge } from './challenge-shape.ts';
import type { NonceLedger } from './nonce-store.ts';
import type { PinnedKey } from './pin.ts';
import type { OwnerProofAdapter } from './port.ts';
import { ownerProofRecord } from './record-bytes.ts';
import type { OwnerProofRecord } from './record.ts';
import type { ProofState, TurnedDownWhy } from './state.ts';
import { actDigest, verifyProof, type ActBinding, type ProofRefusal } from './verify.ts';

export interface ProveActDeps {
  readonly state: ProofState;
  readonly adapter: OwnerProofAdapter;
  readonly ledger: Pick<NonceLedger, 'issue' | 'take'>;
  readonly clock: Clock;
  /** How long the challenge stays signable (owner.proof.ttlSeconds). */
  readonly ttlSeconds: number;
  /** Makes the act id the nonce is spent by; a lowercase UUID. */
  readonly newActId?: (() => string) | undefined;
}

/** The act to prove, and the pinned key to sign it with when the owner pinned more than one. */
export interface ProveActRequest {
  readonly binding: ActBinding;
  readonly keyId?: string | undefined;
}

/** Why an act was not proved; every one leaves the act unrun and in the owner's decision queue. */
export type ProveRefusal =
  | { readonly kind: 'turned-down'; readonly why: TurnedDownWhy }
  | { readonly kind: 'adapter-changed'; readonly configured: string; readonly running: string }
  | { readonly kind: 'key-unknown'; readonly keyId: string }
  | { readonly kind: 'key-ambiguous'; readonly keyIds: readonly string[] }
  | { readonly kind: 'declined' }
  | { readonly kind: 'unavailable'; readonly why: string }
  | { readonly kind: 'not-verified'; readonly reason: ProofRefusal };

/**
 * - off: no key was ever enrolled, so the act runs as before the proof existed.
 * - proved: the owner's key signed this act now; the record goes on the act's event.
 * - refused: the act must not run.
 */
export type ProveOutcome =
  | { readonly kind: 'off' }
  | { readonly kind: 'proved'; readonly record: OwnerProofRecord }
  | { readonly kind: 'refused'; readonly refusal: ProveRefusal };

/** The pinned key a proof signs with: the one named, else the only pin; several pins and none named is refused. */
export function signingKey(pins: readonly PinnedKey[], keyId: string | undefined): string | ProveRefusal {
  if (keyId !== undefined) {
    return pins.some((pin) => pin.keyId === keyId) ? keyId : { kind: 'key-unknown', keyId };
  }
  const [only, ...rest] = pins;
  if (only !== undefined && rest.length === 0) return only.keyId;
  return { kind: 'key-ambiguous', keyIds: pins.map((pin) => pin.keyId) };
}

function refused(refusal: ProveRefusal): ProveOutcome {
  return { kind: 'refused', refusal };
}

/**
 * Asks the owner's key to sign one owner-only act now and checks the signature at once (T4758 C1 design pick 3): a
 * nonce is issued for the act, the adapter signs the challenge's digest after the owner's gesture, and the nonce is
 * spent by a fresh act id before the signature is verified, so it is one use whatever the check says. A nonce whose
 * signing was declined stays unused and expires. The binding comes from what teamrig is about to run, never from the
 * proof.
 */
export async function proveAct(deps: ProveActDeps, request: ProveActRequest): Promise<ProveOutcome> {
  const { state, adapter, ledger, clock } = deps;
  if (state.kind === 'off') return { kind: 'off' };
  if (state.kind === 'turned-down') return refused({ kind: 'turned-down', why: state.why });
  if (adapter.id !== state.adapter) return refused({ kind: 'adapter-changed', configured: state.adapter, running: adapter.id });
  const keyId = signingKey(state.pins, request.keyId);
  if (typeof keyId !== 'string') return refused(keyId);
  const { binding } = request;
  const issuedAt = clock.now();
  const expires = issuedAt + deps.ttlSeconds * 1000;
  const nonce = await ledger.issue(actDigest(binding), expires);
  const challenge: OwnerProofChallenge = {
    domain: PROOF_DOMAIN,
    keyId,
    hostId: binding.hostId,
    team: binding.team,
    act: binding.act,
    commit: binding.commit,
    cardDigest: binding.cardDigest,
    nonce,
    issuedAt: new Date(issuedAt).toISOString(),
    expires: new Date(expires).toISOString(),
  };
  const signed = await adapter.sign(keyId, challengeHex(challenge));
  if (signed.kind === 'declined') return refused({ kind: 'declined' });
  if (signed.kind === 'unavailable') return refused({ kind: 'unavailable', why: signed.why });
  const actId = (deps.newActId ?? randomUUID)();
  const nonceState = await ledger.take(nonce, actId);
  const verdict = verifyProof({ challenge, signature: signed.signature, pins: state.pins, expected: binding, nonce: nonceState, now: clock.now() });
  if (!verdict.ok) return refused({ kind: 'not-verified', reason: verdict.reason });
  return { kind: 'proved', record: ownerProofRecord(actId, challenge, signed.signature) };
}
