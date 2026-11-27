import { randomBytes } from 'node:crypto';
import type { KitConfig } from '../config/types.ts';
import type { TeamPaths } from '../core/home.ts';
import { readHostId } from '../core/host-id.ts';
import { NonceLedger } from '../owner-proof/nonce-store.ts';
import { proveAct, type ProveOutcome, type ProveRefusal } from '../owner-proof/prove.ts';
import { proofState, type ProofState } from '../owner-proof/state.ts';
import type { ActBinding } from '../owner-proof/verify.ts';
import { fileLockOf, type FileLockRuntime } from './file-locks.ts';
import type { CliRuntime } from './runtime.ts';

/** The runtime parts an owner-only act's proof takes. */
export type OwnerProofRuntime = FileLockRuntime & Pick<CliRuntime, 'ownerProof'>;

/** How long past its expiry a nonce stays in the ledger, so a late proof reads as expired rather than unknown. */
export const NONCE_GRACE_MS = 86_400_000;

/**
 * Whether the team's owner-only acts ask for a proof. The adapter is asked whether it is ready only when a pin is
 * there to sign with. Until the pin history is written at enrol (T4758 C4 b) an enrolment is known from the pins alone.
 */
export async function teamProofState(runtime: Pick<CliRuntime, 'ownerProof'>, config: KitConfig): Promise<ProofState> {
  const { proof } = config.owner;
  const adapterAvailable = proof.pins.length > 0 && (await runtime.ownerProof(proof.adapter).available());
  return proofState({ proof, adapterAvailable, enrolmentRecorded: false });
}

/** The act to prove, as teamrig is about to run it; the host id is this machine's, read at the proof. */
export type OwnerAct = Omit<ActBinding, 'hostId'>;

/**
 * Asks the owner's key to sign `act` now (proveAct), with this machine's host id under the kit home and the team's
 * nonce ledger. An `off` state answers at once, asking nothing, so an act runs as before the proof existed.
 */
export async function proveOwnerAct(runtime: OwnerProofRuntime, paths: TeamPaths, config: KitConfig, state: ProofState, act: OwnerAct): Promise<ProveOutcome> {
  if (state.kind === 'off') return { kind: 'off' };
  const hostId = await readHostId(runtime.files, paths.kitHome, () => randomBytes(16).toString('hex'));
  const ledger = new NonceLedger({
    files: runtime.files,
    mutex: fileLockOf(runtime, paths.ownerProofNoncesLock, config.lock),
    clock: runtime.clock,
    path: paths.ownerProofNonces,
    graceMs: NONCE_GRACE_MS,
  });
  const { proof } = config.owner;
  // The act id is proveAct's own random UUID: a proof record refuses any other form, which runtime.newId need not give.
  const deps = { state, adapter: runtime.ownerProof(proof.adapter), ledger, clock: runtime.clock, ttlSeconds: proof.ttlSeconds };
  return proveAct(deps, { binding: { ...act, hostId } });
}

const TURNED_DOWN = {
  'no-pins': 'a key was enrolled but owner.proof.pins holds none now',
  'adapter-none': 'a key was enrolled but owner.proof.adapter is none now',
  'adapter-unavailable': "owner.proof.adapter's key cannot sign on this system now",
} as const;

/** Why the act was not proved, in words the owner reads; it stays in the decision queue either way. */
export function proveRefusalText(refusal: ProveRefusal): string {
  switch (refusal.kind) {
    case 'turned-down':
      return `the owner proof is turned down: ${TURNED_DOWN[refusal.why]}`;
    case 'adapter-changed':
      return `the owner proof is set for ${refusal.configured}, but this run has ${refusal.running}`;
    case 'key-unknown':
      return `no pinned owner key is named ${refusal.keyId}`;
    case 'key-ambiguous':
      return `several owner keys are pinned (${refusal.keyIds.join(', ')}) and the act names none to sign with`;
    case 'declined':
      return 'the owner declined the proof at the prompt';
    case 'unavailable':
      return `the owner's key could not sign: ${refusal.why}`;
    case 'not-verified':
      return `the owner's proof did not verify (${refusal.reason})`;
  }
}
