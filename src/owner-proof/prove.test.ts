import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';
import { FakeClock } from '../testing/fake-clock.ts';
import { fakeOwnerProof, ownerProofWorld, type OwnerProofWorld } from '../testing/fake-owner-proof.ts';
import { InlineMutex } from '../testing/inline-mutex.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { challengeHex } from './challenge.ts';
import { NonceLedger, parseLedger } from './nonce-store.ts';
import type { PinnedKey } from './pin.ts';
import type { OwnerProofAdapter } from './port.ts';
import { proveAct, signingKey, type ProveActDeps, type ProveOutcome } from './prove.ts';
import { recordSignature } from './record-bytes.ts';
import type { ProofState } from './state.ts';
import { verifyRecordedProof, type ActBinding } from './verify.ts';

const PATH = 'team/state/owner-proof-nonces.json';
const ACT_ID = '00000000-0000-4000-8000-00000000000a';
const START = Date.parse('2030-01-08T11:00:00.000Z');

const BINDING: ActBinding = {
  team: 'alpha',
  hostId: '0'.repeat(32),
  act: ['owner', 'decide', 'alpha/T1', '--approve'],
  commit: null,
  cardDigest: 'c'.repeat(64),
};

interface Rig {
  readonly world: OwnerProofWorld;
  readonly adapter: OwnerProofAdapter;
  readonly files: MemoryFiles;
  readonly ledger: NonceLedger;
  readonly clock: FakeClock;
}

function rig(world: OwnerProofWorld = ownerProofWorld()): Rig {
  const files = new MemoryFiles();
  const clock = new FakeClock(START);
  const ledger = new NonceLedger({ files, mutex: new InlineMutex(), clock, path: PATH, graceMs: 0 });
  return { world, adapter: fakeOwnerProof(world), files, ledger, clock };
}

async function enrol(adapter: OwnerProofAdapter, keyId: string): Promise<PinnedKey> {
  const outcome = await adapter.enrol(keyId);
  assert.equal(outcome.kind, 'enrolled');
  if (outcome.kind !== 'enrolled') throw new Error('not enrolled');
  return outcome.key;
}

function on(pins: readonly PinnedKey[]): ProofState {
  return { kind: 'on', adapter: 'windows-hello', pins };
}

function deps(r: Rig, state: ProofState): ProveActDeps {
  return { state, adapter: r.adapter, ledger: r.ledger, clock: r.clock, ttlSeconds: 300, newActId: () => ACT_ID };
}

function proved(outcome: ProveOutcome): Extract<ProveOutcome, { kind: 'proved' }> {
  assert.equal(outcome.kind, 'proved', JSON.stringify(outcome));
  if (outcome.kind !== 'proved') throw new Error('not proved');
  return outcome;
}

describe('proveAct', () => {
  it('asks nothing while the proof is off: the act runs as before', async () => {
    const r = rig();
    assert.deepEqual(await proveAct(deps(r, { kind: 'off' }), { binding: BINDING }), { kind: 'off' });
    assert.deepEqual(r.world.prompts, []);
    assert.equal(r.files.get(PATH), undefined);
  });

  it('refuses every act while the proof is turned down, before any prompt', async () => {
    const r = rig();
    const outcome = await proveAct(deps(r, { kind: 'turned-down', why: 'no-pins' }), { binding: BINDING });
    assert.deepEqual(outcome, { kind: 'refused', refusal: { kind: 'turned-down', why: 'no-pins' } });
    assert.deepEqual(r.world.prompts, []);
  });

  it('refuses when the running adapter is not the configured one', async () => {
    const r = rig();
    const pin = await enrol(r.adapter, 'key-1');
    const outcome = await proveAct(deps(r, { kind: 'on', adapter: 'touch-id', pins: [pin] }), { binding: BINDING });
    assert.deepEqual(outcome, { kind: 'refused', refusal: { kind: 'adapter-changed', configured: 'touch-id', running: 'windows-hello' } });
  });

  it('signs the challenge for exactly this act, spends its nonce by the act id, and records a proof that verifies later', async () => {
    const r = rig();
    const pin = await enrol(r.adapter, 'key-1');
    const { record } = proved(await proveAct(deps(r, on([pin])), { binding: BINDING }));
    assert.equal(record.actId, ACT_ID);
    assert.deepEqual(record.challenge.act, BINDING.act);
    assert.equal(record.challenge.keyId, 'key-1');
    assert.equal(record.challenge.issuedAt, '2030-01-08T11:00:00.000Z');
    assert.equal(record.challenge.expires, '2030-01-08T11:05:00.000Z');
    assert.deepEqual(r.world.prompts, ['enrol key-1', challengeHex(record.challenge)]);
    const nonce = await r.ledger.read(record.challenge.nonce);
    assert.equal(nonce.kind === 'used' ? nonce.spentBy : nonce.kind, ACT_ID);
    r.clock.advance(3_600_000);
    const later = verifyRecordedProof({ challenge: record.challenge, signature: recordSignature(record), pins: [pin], expected: BINDING, nonce, actId: record.actId });
    assert.deepEqual(later, { ok: true, keyId: 'key-1' });
  });

  it('signs with the named pin when several are pinned, and refuses an unnamed or unknown one', async () => {
    const r = rig();
    const first = await enrol(r.adapter, 'key-1');
    const second = await enrol(r.adapter, 'key-2');
    const { record } = proved(await proveAct(deps(r, on([first, second])), { binding: BINDING, keyId: 'key-2' }));
    assert.equal(record.challenge.keyId, 'key-2');
    assert.deepEqual(await proveAct(deps(r, on([first, second])), { binding: BINDING }), {
      kind: 'refused',
      refusal: { kind: 'key-ambiguous', keyIds: ['key-1', 'key-2'] },
    });
    assert.deepEqual(await proveAct(deps(r, on([first])), { binding: BINDING, keyId: 'key-9' }), {
      kind: 'refused',
      refusal: { kind: 'key-unknown', keyId: 'key-9' },
    });
  });

  it('refuses a declined gesture and leaves its nonce unspent, to expire', async () => {
    const r = rig();
    const pin = await enrol(r.adapter, 'key-1');
    r.world.gesture = 'decline';
    assert.deepEqual(await proveAct(deps(r, on([pin])), { binding: BINDING }), { kind: 'refused', refusal: { kind: 'declined' } });
    const [entry] = parseLedger(r.files.get(PATH), PATH);
    assert.equal(entry?.spentBy, null);
  });

  it('refuses when the system cannot sign', async () => {
    const r = rig();
    const pin = await enrol(r.adapter, 'key-1');
    r.world.ready = false;
    assert.deepEqual(await proveAct(deps(r, on([pin])), { binding: BINDING }), {
      kind: 'refused',
      refusal: { kind: 'unavailable', why: 'the fake system is not ready' },
    });
  });

  it('refuses a signature the pinned key does not verify, and still spends the nonce', async () => {
    const r = rig();
    await enrol(r.adapter, 'key-1');
    const stranger = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const pin: PinnedKey = { keyId: 'key-1', algorithm: 'ed25519', publicKeyPem: stranger };
    assert.deepEqual(await proveAct(deps(r, on([pin])), { binding: BINDING }), {
      kind: 'refused',
      refusal: { kind: 'not-verified', reason: 'bad-signature' },
    });
    const [entry] = parseLedger(r.files.get(PATH), PATH);
    assert.equal(entry?.spentBy, ACT_ID);
  });

  it('refuses a ttl past the lifetime ceiling', async () => {
    const r = rig();
    const pin = await enrol(r.adapter, 'key-1');
    const outcome = await proveAct({ ...deps(r, on([pin])), ttlSeconds: 601 }, { binding: BINDING });
    assert.deepEqual(outcome, { kind: 'refused', refusal: { kind: 'not-verified', reason: 'lifetime-too-long' } });
  });
});

describe('signingKey', () => {
  it('takes the only pin when none is named, and refuses an empty pin list as ambiguous', () => {
    const pin: PinnedKey = { keyId: 'key-1', algorithm: 'ed25519', publicKeyPem: 'pem' };
    assert.equal(signingKey([pin], undefined), 'key-1');
    assert.deepEqual(signingKey([], undefined), { kind: 'key-ambiguous', keyIds: [] });
  });
});
