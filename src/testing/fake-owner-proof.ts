import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { isHex64 } from '../owner-proof/challenge.ts';
import type { OwnerProofAdapter, OwnerProofAdapterId, EnrolOutcome, SignOutcome } from '../owner-proof/port.ts';

/** What the fake's owner does at a prompt, whether the system is ready, and each prompt it was shown. */
export interface OwnerProofWorld {
  gesture: 'approve' | 'decline';
  ready: boolean;
  /** Each prompt shown: enrol of a key id, or the digest a sign was asked for. */
  readonly prompts: string[];
}

export function ownerProofWorld(overrides: Partial<OwnerProofWorld> = {}): OwnerProofWorld {
  return { gesture: 'approve', ready: true, prompts: [], ...overrides };
}

/**
 * An owner's proof adapter held in memory: an Ed25519 key per enrolled id, a prompt recorded for each gesture asked,
 * and the world's gesture answering it. It passes the adapter contract (owner-proof-contract.ts), as each real one must.
 */
export function fakeOwnerProof(world: OwnerProofWorld, id: OwnerProofAdapterId = 'windows-hello'): OwnerProofAdapter {
  const keys = new Map<string, KeyObject>();
  const notReady = { kind: 'unavailable', why: 'the fake system is not ready' } as const;
  return {
    id,
    available: () => Promise.resolve(world.ready),
    enrol: (keyId): Promise<EnrolOutcome> => {
      if (!world.ready) return Promise.resolve(notReady);
      world.prompts.push(`enrol ${keyId}`);
      if (world.gesture === 'decline') return Promise.resolve({ kind: 'declined' });
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      keys.set(keyId, privateKey);
      const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
      return Promise.resolve({ kind: 'enrolled', key: { keyId, algorithm: 'ed25519', publicKeyPem } });
    },
    sign: (keyId, digestHex): Promise<SignOutcome> => {
      if (!isHex64(digestHex)) return Promise.resolve({ kind: 'unavailable', why: 'the challenge is not 64 lowercase hex digits' });
      const key = keys.get(keyId);
      if (!world.ready) return Promise.resolve(notReady);
      if (key === undefined) return Promise.resolve({ kind: 'unavailable', why: `no key named ${keyId}` });
      world.prompts.push(digestHex);
      if (world.gesture === 'decline') return Promise.resolve({ kind: 'declined' });
      return Promise.resolve({ kind: 'signed', signature: sign(null, Buffer.from(digestHex, 'hex'), key) });
    },
  };
}
