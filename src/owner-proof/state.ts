import type { OwnerProofConfig } from '../config/types.ts';
import type { OwnerProofAdapterId } from './port.ts';
import type { PinnedKey } from './pin.ts';

/** Why an enrolled proof cannot sign: every owner-only act is refused and sent to the decision queue. */
export type TurnedDownWhy = 'no-pins' | 'adapter-none' | 'adapter-unavailable';

/**
 * Whether owner-only acts ask for a proof.
 * - off: no key was ever enrolled; acts run as before the proof existed.
 * - on: an adapter that can sign and at least one pin; each act asks for a proof.
 * - turned-down: a key was enrolled but the proof cannot sign; each act is refused, never run unguarded, and
 *   `check` shows the owner `proof turned down unsigned`.
 */
export type ProofState =
  | { readonly kind: 'off' }
  | { readonly kind: 'on'; readonly adapter: Exclude<OwnerProofAdapterId, 'none'>; readonly pins: readonly PinnedKey[] }
  | { readonly kind: 'turned-down'; readonly why: TurnedDownWhy };

export interface ProofStateInput {
  readonly proof: OwnerProofConfig;
  /** Whether the configured adapter answers ready on this host; ignored for `none`. */
  readonly adapterAvailable: boolean;
  /**
   * Whether the pin history or the off-account copy records an enrolment, whatever the config says now. It is what
   * keeps a file whose every pin the parser dropped (a bad PEM) turned down: the parsed config holds only the file's
   * own keys, so it cannot say that a pin was there.
   */
  readonly enrolmentRecorded: boolean;
}

/**
 * The state comes from whether a key was ever enrolled, never from `adapter` alone: the parser turns a bad adapter
 * into `none` and drops a bad pin, so one bad config write must turn the proof down, not off (T4758 security read, O3).
 */
export function proofState(input: ProofStateInput): ProofState {
  const { proof, adapterAvailable, enrolmentRecorded } = input;
  const enrolled = proof.pins.length > 0 || enrolmentRecorded;
  if (!enrolled) return { kind: 'off' };
  if (proof.pins.length === 0) return { kind: 'turned-down', why: 'no-pins' };
  if (proof.adapter === 'none') return { kind: 'turned-down', why: 'adapter-none' };
  if (!adapterAvailable) return { kind: 'turned-down', why: 'adapter-unavailable' };
  return { kind: 'on', adapter: proof.adapter, pins: proof.pins };
}
