import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OwnerProofConfig } from '../config/types.ts';
import type { PinnedKey } from './pin.ts';
import { proofState, type ProofStateInput } from './state.ts';

const pin: PinnedKey = {
  keyId: 'key-1',
  algorithm: 'ed25519',
  publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----',
};

function input(proof: Partial<OwnerProofConfig>, rest: Partial<Omit<ProofStateInput, 'proof'>> = {}): ProofStateInput {
  return {
    proof: { adapter: 'windows-hello', ttlSeconds: 300, pins: [pin], ...proof },
    adapterAvailable: true,
    enrolmentRecorded: false,
    ...rest,
  };
}

describe('proofState', () => {
  it('is off when no key was ever enrolled, as before the proof existed', () => {
    assert.deepEqual(proofState(input({ adapter: 'none', pins: [] })), { kind: 'off' });
    assert.deepEqual(proofState(input({ pins: [] })), { kind: 'off' }, 'an adapter alone enrols no key');
  });

  it('is on with a ready adapter and a pin', () => {
    assert.deepEqual(proofState(input({})), { kind: 'on', adapter: 'windows-hello', pins: [pin] });
  });

  it('turns down, never off, an invalid adapter the parser read as none while pins are present', () => {
    assert.deepEqual(proofState(input({ adapter: 'none' })), { kind: 'turned-down', why: 'adapter-none' });
  });

  it('turns down an adapter that is not ready on this host', () => {
    assert.deepEqual(proofState(input({}, { adapterAvailable: false })), { kind: 'turned-down', why: 'adapter-unavailable' });
  });

  it('turns down a file whose every pin was dropped as a bad PEM after an enrolment', () => {
    assert.deepEqual(proofState(input({ pins: [] }, { enrolmentRecorded: true })), { kind: 'turned-down', why: 'no-pins' });
  });

  it('turns down when every pin and the adapter are gone from the file but a remote copy records the enrolment', () => {
    const state = proofState(input({ adapter: 'none', pins: [] }, { enrolmentRecorded: true }));
    assert.deepEqual(state, { kind: 'turned-down', why: 'no-pins' });
  });
});
