import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { KitConfig } from '../config/types.ts';
import { teamPaths } from '../core/home.ts';
import { hostIdFile } from '../core/host-id.ts';
import { parseLedger } from '../owner-proof/nonce-store.ts';
import type { PinnedKey } from '../owner-proof/pin.ts';
import { NO_OWNER_PROOF, unprovedOwnerProof, type OwnerProofAdapter, type OwnerProofAdapters } from '../owner-proof/port.ts';
import type { ProveRefusal } from '../owner-proof/prove.ts';
import { isActId } from '../owner-proof/record.ts';
import { testConfig } from '../testing/config.ts';
import { FakeClock } from '../testing/fake-clock.ts';
import { fakeOwnerProof, ownerProofWorld, type OwnerProofWorld } from '../testing/fake-owner-proof.ts';
import { FakeSessionProcesses } from '../testing/fake-session-processes.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { proveOwnerAct, proveRefusalText, teamProofState, type OwnerAct, type OwnerProofRuntime } from './owner-proof-act.ts';

const KIT = '/kit';
const PATHS = teamPaths(KIT, 'app', undefined);
const ACT: OwnerAct = { team: 'app', act: ['owner', 'decide', 'app/T1', '--approve'], commit: null, cardDigest: 'c'.repeat(64) };

interface Rig {
  readonly world: OwnerProofWorld;
  readonly adapter: OwnerProofAdapter;
  readonly files: MemoryFiles;
  readonly runtime: OwnerProofRuntime;
}

function rig(adapters?: OwnerProofAdapters): Rig {
  const world = ownerProofWorld();
  const adapter = fakeOwnerProof(world);
  const files = new MemoryFiles();
  const clock = new FakeClock(Date.parse('2030-01-08T10:00:00.000Z'));
  const runtime: OwnerProofRuntime = {
    files,
    clock,
    sleep: clock.sleep,
    pid: 4242,
    sessionProcesses: new FakeSessionProcesses(),
    newId: () => 'lock-1',
    ownerProof: adapters ?? ((id) => (id === 'windows-hello' ? adapter : NO_OWNER_PROOF)),
  };
  return { world, adapter, files, runtime };
}

async function pinOf(adapter: OwnerProofAdapter): Promise<PinnedKey> {
  const outcome = await adapter.enrol('teamrig-owner');
  if (outcome.kind !== 'enrolled') throw new Error(`not enrolled: ${outcome.kind}`);
  return outcome.key;
}

function configOf(pins: readonly PinnedKey[], adapter = 'windows-hello'): KitConfig {
  return testConfig({ owner: { proof: { adapter, ttlSeconds: 300, pins: pins.map((pin) => ({ ...pin })) } } });
}

describe('teamProofState', () => {
  it('is off with no pin, asking the adapter nothing', async () => {
    const asked: string[] = [];
    const ownerProof: OwnerProofAdapters = (id) => {
      asked.push(id);
      return NO_OWNER_PROOF;
    };
    const runtime = { ownerProof };
    assert.deepEqual(await teamProofState(runtime, testConfig()), { kind: 'off' });
    assert.deepEqual(asked, []);
  });

  it('is on with a pin and a ready adapter, and turned down when the adapter is not ready', async () => {
    const r = rig();
    const pin = await pinOf(r.adapter);
    assert.deepEqual(await teamProofState(r.runtime, configOf([pin])), { kind: 'on', adapter: 'windows-hello', pins: [pin] });
    const unproved = rig(unprovedOwnerProof);
    assert.deepEqual(await teamProofState(unproved.runtime, configOf([pin])), { kind: 'turned-down', why: 'adapter-unavailable' });
  });
});

describe('proveOwnerAct', () => {
  it('asks nothing and writes nothing while the proof is off', async () => {
    const r = rig();
    assert.deepEqual(await proveOwnerAct(r.runtime, PATHS, testConfig(), { kind: 'off' }, ACT), { kind: 'off' });
    assert.deepEqual(r.world.prompts, []);
    assert.equal(r.files.get(PATHS.ownerProofNonces), undefined);
    assert.equal(r.files.get(hostIdFile(KIT)), undefined);
  });

  it("signs the act with this machine's host id, spends its nonce in the team's ledger and names a UUID act id", async () => {
    const r = rig();
    const config = configOf([await pinOf(r.adapter)]);
    const outcome = await proveOwnerAct(r.runtime, PATHS, config, await teamProofState(r.runtime, config), ACT);
    assert.equal(outcome.kind, 'proved', JSON.stringify(outcome));
    if (outcome.kind !== 'proved') return;
    const { record } = outcome;
    assert.deepEqual(record.challenge.act, ACT.act);
    assert.equal(record.challenge.cardDigest, ACT.cardDigest);
    assert.equal(record.challenge.hostId, r.files.get(hostIdFile(KIT))?.trim());
    assert.equal(isActId(record.actId), true, record.actId);
    const ledger = parseLedger(r.files.get(PATHS.ownerProofNonces), PATHS.ownerProofNonces);
    assert.deepEqual(
      ledger.map((entry) => [entry.nonce, entry.spentBy]),
      [[record.challenge.nonce, record.actId]],
    );
  });

  it('refuses when the owner declines at the prompt', async () => {
    const r = rig();
    const config = configOf([await pinOf(r.adapter)]);
    r.world.gesture = 'decline';
    const outcome = await proveOwnerAct(r.runtime, PATHS, config, await teamProofState(r.runtime, config), ACT);
    assert.deepEqual(outcome, { kind: 'refused', refusal: { kind: 'declined' } });
  });
});

describe('proveRefusalText', () => {
  it('says why in words the owner reads', () => {
    assert.equal(proveRefusalText({ kind: 'declined' }), 'the owner declined the proof at the prompt');
    assert.equal(
      proveRefusalText({ kind: 'turned-down', why: 'adapter-unavailable' }),
      "the owner proof is turned down: owner.proof.adapter's key cannot sign on this system now",
    );
    assert.equal(proveRefusalText({ kind: 'key-ambiguous', keyIds: ['a', 'b'] }), 'several owner keys are pinned (a, b) and the act names none to sign with');
  });

  it('names every refusal by its own words, each turned-down reason and the detail it carries', () => {
    const cases: readonly (readonly [ProveRefusal, string])[] = [
      [{ kind: 'turned-down', why: 'no-pins' }, 'the owner proof is turned down: a key was enrolled but owner.proof.pins holds none now'],
      [{ kind: 'turned-down', why: 'adapter-none' }, 'the owner proof is turned down: a key was enrolled but owner.proof.adapter is none now'],
      [{ kind: 'adapter-changed', configured: 'windows-hello', running: 'none' }, 'the owner proof is set for windows-hello, but this run has none'],
      [{ kind: 'key-unknown', keyId: 'old-key' }, 'no pinned owner key is named old-key'],
      [{ kind: 'unavailable', why: 'no TPM' }, "the owner's key could not sign: no TPM"],
      [{ kind: 'not-verified', reason: 'bad-signature' }, "the owner's proof did not verify (bad-signature)"],
    ];
    for (const [refusal, text] of cases) assert.equal(proveRefusalText(refusal), text, refusal.kind);
  });
});
