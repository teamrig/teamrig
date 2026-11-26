import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PROOF_DOMAIN, challengeHex, type OwnerProofChallenge } from '../owner-proof/challenge.ts';
import type { OwnerProofAdapter } from '../owner-proof/port.ts';
import { actDigest, verifyProof, type PinnedKey } from '../owner-proof/verify.ts';
import { ownerProofWorld, type OwnerProofWorld } from './fake-owner-proof.ts';

/** Makes the adapter under test over a world whose owner gesture and readiness a case sets. */
export type OwnerProofSubject = (world: OwnerProofWorld) => OwnerProofAdapter;

const KEY_ID = 'teamrig-owner';

function challengeFor(keyId: string): OwnerProofChallenge {
  return {
    domain: PROOF_DOMAIN,
    keyId,
    hostId: 'host-1',
    team: 'alpha',
    act: ['merge', 'T12'],
    commit: 'd'.repeat(40),
    cardDigest: null,
    nonce: 'a'.repeat(64),
    issuedAt: '2026-11-26T07:00:00.000Z',
    expires: '2026-11-26T07:05:00.000Z',
  };
}

async function enrolled(adapter: OwnerProofAdapter): Promise<PinnedKey> {
  const outcome = await adapter.enrol(KEY_ID);
  assert.equal(outcome.kind, 'enrolled');
  if (outcome.kind !== 'enrolled') throw new Error('unreachable: asserted enrolled');
  return outcome.key;
}

/**
 * The contract every owner's proof adapter passes, its fake too: a ready system enrols a key whose signature
 * verifyProof accepts for exactly the challenge signed; a declined gesture signs nothing; a challenge not in 64-hex
 * form is refused before any prompt; a key it never made and a system not ready answer unavailable.
 */
export function describeOwnerProofContract(name: string, subject: OwnerProofSubject): void {
  describe(`${name}: the owner proof adapter contract`, () => {
    it('is available on a ready system, and not on one that is not', async () => {
      assert.equal(await subject(ownerProofWorld()).available(), true);
      assert.equal(await subject(ownerProofWorld({ ready: false })).available(), false);
    });

    it('enrols a key whose signature of a challenge verifies for that challenge', async () => {
      const world = ownerProofWorld();
      const adapter = subject(world);
      const pin = await enrolled(adapter);
      const challenge = challengeFor(pin.keyId);
      const outcome = await adapter.sign(pin.keyId, challengeHex(challenge));
      assert.equal(outcome.kind, 'signed');
      if (outcome.kind !== 'signed') return;
      const verdict = verifyProof({
        challenge,
        signature: outcome.signature,
        pins: [pin],
        expected: challenge,
        nonce: { kind: 'issued', actDigest: actDigest(challenge) },
        now: Date.parse('2026-11-26T07:01:00.000Z'),
      });
      assert.deepEqual(verdict, { ok: true, keyId: KEY_ID });
      assert.equal(world.prompts.length, 2);
    });

    it('signs nothing when the owner declines the gesture, at enrolment or at a signature', async () => {
      const world = ownerProofWorld();
      const adapter = subject(world);
      const pin = await enrolled(adapter);
      world.gesture = 'decline';
      assert.deepEqual(await adapter.sign(pin.keyId, challengeHex(challengeFor(pin.keyId))), { kind: 'declined' });
      assert.deepEqual(await subject(ownerProofWorld({ gesture: 'decline' })).enrol(KEY_ID), { kind: 'declined' });
    });

    it('refuses a challenge not in 64 lowercase hex form before any prompt', async () => {
      const world = ownerProofWorld();
      const adapter = subject(world);
      const pin = await enrolled(adapter);
      const shown = world.prompts.length;
      const hex = challengeHex(challengeFor(pin.keyId));
      for (const bad of [hex.toUpperCase(), hex.slice(1), `${hex}0`, `${hex.slice(0, 63)} `, '']) {
        assert.equal((await adapter.sign(pin.keyId, bad)).kind, 'unavailable', bad);
      }
      assert.equal(world.prompts.length, shown);
    });

    it('answers unavailable for a key it never made, and on a system not ready, with no prompt', async () => {
      const world = ownerProofWorld();
      const adapter = subject(world);
      const hex = challengeHex(challengeFor('never-made'));
      assert.equal((await adapter.sign('never-made', hex)).kind, 'unavailable');
      world.ready = false;
      assert.equal((await adapter.enrol(KEY_ID)).kind, 'unavailable');
      assert.equal((await adapter.sign(KEY_ID, hex)).kind, 'unavailable');
      assert.deepEqual(world.prompts, []);
    });
  });
}
