import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, it } from 'node:test';
import { PROOF_DOMAIN, challengeDigest, type OwnerProofChallenge } from './challenge.ts';
import type { PinnedKey, SignatureAlgorithm } from './pin.ts';
import { ISSUED_AT_SKEW_MS, actDigest, verifyProof, type ActBinding, type NonceState, type ProofCheck } from './verify.ts';

interface TestKey {
  readonly pin: PinnedKey;
  readonly sign: (data: Buffer) => Buffer;
}

function pem(key: KeyObject): string {
  return key.export({ type: 'spki', format: 'pem' }).toString();
}

function rsaKey(keyId: string, modulusLength = 2048): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength });
  return { pin: { keyId, algorithm: 'rsa-pkcs1-sha256', publicKeyPem: pem(publicKey) }, sign: (data) => sign('sha256', data, privateKey) };
}

function ecKey(keyId: string): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { pin: { keyId, algorithm: 'ecdsa-p256-sha256', publicKeyPem: pem(publicKey) }, sign: (data) => sign('sha256', data, privateKey) };
}

function edKey(keyId: string): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pin: { keyId, algorithm: 'ed25519', publicKeyPem: pem(publicKey) }, sign: (data) => sign(null, data, privateKey) };
}

const now = Date.parse('2026-11-26T07:01:00.000Z');

const binding: ActBinding = {
  team: 'alpha',
  hostId: 'host-1',
  act: ['merge', 'T12'],
  commit: 'd'.repeat(40),
  cardDigest: 'c'.repeat(64),
};

function challengeFor(keyId: string, overrides: Partial<OwnerProofChallenge> = {}): OwnerProofChallenge {
  return {
    domain: PROOF_DOMAIN,
    keyId,
    ...binding,
    nonce: 'a'.repeat(64),
    issuedAt: '2026-11-26T07:00:00.000Z',
    expires: '2026-11-26T07:05:00.000Z',
    ...overrides,
  };
}

const issued: NonceState = { kind: 'issued', actDigest: actDigest(binding) };

function check(key: TestKey, overrides: Partial<ProofCheck> = {}, challengeOverrides: Partial<OwnerProofChallenge> = {}): ProofCheck {
  const challenge = challengeFor(key.pin.keyId, challengeOverrides);
  return { challenge, signature: key.sign(challengeDigest(challenge)), pins: [key.pin], expected: binding, nonce: issued, now, ...overrides };
}

const rsa = rsaKey('key-rsa');

describe('verifyProof', () => {
  it('passes a challenge signed by a pinned key of each scheme', () => {
    for (const key of [rsa, ecKey('key-ec'), edKey('key-ed')]) {
      assert.deepEqual(verifyProof(check(key)), { ok: true, keyId: key.pin.keyId });
    }
  });

  it('refuses a key id no pin holds', () => {
    assert.deepEqual(verifyProof(check(rsa, { pins: [] })), { ok: false, reason: 'unknown-key' });
  });

  it('refuses a challenge made for another act, commit, card, team or host', () => {
    const others: readonly Partial<OwnerProofChallenge>[] = [
      { act: ['merge', 'T13'] },
      { commit: 'e'.repeat(40) },
      { cardDigest: null },
      { team: 'beta' },
      { hostId: 'host-2' },
    ];
    for (const other of others) assert.deepEqual(verifyProof(check(rsa, {}, other)), { ok: false, reason: 'other-act' });
  });

  it('refuses a nonce never issued, one already used, and one issued for another act', () => {
    assert.deepEqual(verifyProof(check(rsa, { nonce: { kind: 'unknown' } })), { ok: false, reason: 'nonce-unknown' });
    assert.deepEqual(verifyProof(check(rsa, { nonce: { kind: 'used' } })), { ok: false, reason: 'nonce-used' });
    const otherAct: NonceState = { kind: 'issued', actDigest: actDigest({ ...binding, act: ['merge', 'T13'] }) };
    assert.deepEqual(verifyProof(check(rsa, { nonce: otherAct })), { ok: false, reason: 'nonce-other-act' });
  });

  it('refuses an expired challenge, from its expiry on', () => {
    assert.deepEqual(verifyProof(check(rsa, { now: Date.parse('2026-11-26T07:05:00.000Z') })), { ok: false, reason: 'expired' });
    assert.equal(verifyProof(check(rsa, { now: Date.parse('2026-11-26T07:04:59.999Z') })).ok, true);
  });

  it('refuses an issuedAt in the future past the skew, and takes one within it', () => {
    const issuedAt = Date.parse('2026-11-26T07:00:00.000Z');
    assert.deepEqual(verifyProof(check(rsa, { now: issuedAt - ISSUED_AT_SKEW_MS - 1 })), { ok: false, reason: 'issued-in-future' });
    assert.equal(verifyProof(check(rsa, { now: issuedAt - ISSUED_AT_SKEW_MS })).ok, true);
  });

  it('fails closed on a time out of form, even a challenge built in code that parseChallenge never read: NaN passes no compare', () => {
    const outOfForm: readonly Partial<OwnerProofChallenge>[] = [
      { issuedAt: 'yesterday' },
      { expires: 'later' },
      { issuedAt: '2026-11-26T09:00:00.000+02:00' },
      { expires: '2026-11-26 07:05:00Z' },
      { issuedAt: '2026-11-26T07:00:00Z' },
      { expires: '2026-02-30T07:05:00.000Z' },
    ];
    for (const times of outOfForm) assert.deepEqual(verifyProof(check(rsa, {}, times)), { ok: false, reason: 'bad-times' }, JSON.stringify(times));
    assert.deepEqual(verifyProof(check(rsa, { now: Number.NaN })), { ok: false, reason: 'bad-times' });
  });

  it('refuses a challenge that expires when or before it was issued', () => {
    for (const expires of ['2026-11-26T07:00:00.000Z', '2026-11-26T06:59:59.999Z']) {
      assert.deepEqual(verifyProof(check(rsa, { now: Date.parse('2026-11-26T06:59:00.000Z') }, { expires })), { ok: false, reason: 'bad-times' }, expires);
    }
  });

  it('refuses a challenge that lives longer than the ceiling', () => {
    assert.deepEqual(verifyProof(check(rsa, {}, { expires: '2026-11-26T07:10:00.001Z' })), { ok: false, reason: 'lifetime-too-long' });
    assert.equal(verifyProof(check(rsa, {}, { expires: '2026-11-26T07:10:00.000Z' })).ok, true);
  });

  it('refuses a signature over another challenge, a changed one, or by another key', () => {
    const signed = check(rsa);
    const other = challengeFor(rsa.pin.keyId, { nonce: 'b'.repeat(64) });
    assert.deepEqual(verifyProof({ ...signed, signature: rsa.sign(challengeDigest(other)) }), { ok: false, reason: 'bad-signature' });
    const flipped = Buffer.from(signed.signature);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    assert.deepEqual(verifyProof({ ...signed, signature: flipped }), { ok: false, reason: 'bad-signature' });
    const stranger = rsaKey('key-rsa');
    assert.deepEqual(verifyProof({ ...signed, signature: stranger.sign(challengeDigest(signed.challenge)) }), { ok: false, reason: 'bad-signature' });
  });

  it('verifies by the pin algorithm, never another: a key of one scheme pinned as another fails', () => {
    const ed = edKey('key-ed');
    const algorithms: readonly SignatureAlgorithm[] = ['rsa-pkcs1-sha256', 'ecdsa-p256-sha256'];
    for (const algorithm of algorithms) {
      assert.deepEqual(verifyProof(check(ed, { pins: [{ ...ed.pin, algorithm }] })), { ok: false, reason: 'bad-signature' });
    }
    assert.deepEqual(verifyProof(check(rsa, { pins: [{ ...rsa.pin, algorithm: 'ed25519' }] })), { ok: false, reason: 'bad-signature' });
  });

  it('refuses a pin whose key does not parse, and a signature that is no DER', () => {
    assert.deepEqual(verifyProof(check(rsa, { pins: [{ ...rsa.pin, publicKeyPem: 'not a key' }] })), { ok: false, reason: 'bad-signature' });
    const ec = ecKey('key-ec');
    assert.deepEqual(verifyProof({ ...check(ec), signature: Buffer.from('not der') }), { ok: false, reason: 'bad-signature' });
  });

  it('refuses an EC key on another curve pinned as ecdsa-p256-sha256, even with a good signature', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    const p384: TestKey = {
      pin: { keyId: 'key-p384', algorithm: 'ecdsa-p256-sha256', publicKeyPem: pem(publicKey) },
      sign: (data) => sign('sha256', data, privateKey),
    };
    assert.deepEqual(verifyProof(check(p384)), { ok: false, reason: 'bad-signature' });
  });

  it('refuses an RSA pin under 2048 bits, even with a good signature, so a pin past the config check still fails (T5792)', () => {
    assert.deepEqual(verifyProof(check(rsaKey('key-rsa-1024', 1024))), { ok: false, reason: 'bad-signature' });
    assert.deepEqual(verifyProof(check(rsaKey('key-rsa-2040', 2040))), { ok: false, reason: 'bad-signature' });
  });
});
