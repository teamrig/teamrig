import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PROOF_DOMAIN, challengeDigest, challengeHex, challengeText, isHex64, parseChallenge, type OwnerProofChallenge } from './challenge.ts';

const card = 'c'.repeat(64);

const vector: OwnerProofChallenge = {
  domain: PROOF_DOMAIN,
  keyId: 'key-1',
  hostId: 'host-1',
  team: 'alpha',
  act: ['owner', 'decide', 'T12', '--approve', '--read', card],
  commit: null,
  cardDigest: card,
  nonce: 'a'.repeat(64),
  issuedAt: '2026-11-26T07:00:00.000Z',
  expires: '2026-11-26T07:05:00.000Z',
};

describe('owner proof challenge', () => {
  it('pins the canonical text and digest of a fixed challenge, so a change to either is seen', () => {
    assert.equal(
      challengeText(vector),
      `{"act":["owner","decide","T12","--approve","--read","${card}"],"cardDigest":"${card}","commit":null,` +
        `"domain":"teamrig-owner-proof/v1","expires":"2026-11-26T07:05:00.000Z","hostId":"host-1",` +
        `"issuedAt":"2026-11-26T07:00:00.000Z","keyId":"key-1","nonce":"${'a'.repeat(64)}","team":"alpha"}`,
    );
    assert.equal(challengeHex(vector), 'e85a5f8b61af1fc0053a037104005fffcc73cdd44605ca0dcf7133098b88a4fb');
    assert.equal(challengeDigest(vector).length, 32);
  });

  it('gives a different digest for any changed field', () => {
    const changed: readonly OwnerProofChallenge[] = [
      { ...vector, keyId: 'key-2' },
      { ...vector, hostId: 'host-2' },
      { ...vector, team: 'beta' },
      { ...vector, act: ['owner', 'decide', 'T12', '--decline', '--read', card] },
      { ...vector, commit: 'd'.repeat(40) },
      { ...vector, cardDigest: null },
      { ...vector, nonce: 'b'.repeat(64) },
      { ...vector, issuedAt: '2026-11-26T07:00:01.000Z' },
      { ...vector, expires: '2026-11-26T07:05:01.000Z' },
    ];
    const digests = new Set([challengeHex(vector), ...changed.map(challengeHex)]);
    assert.equal(digests.size, changed.length + 1);
  });

  it('reads back a challenge it wrote', () => {
    assert.deepEqual(parseChallenge(JSON.parse(challengeText(vector))), vector);
  });

  it('reads no challenge from a record missing a field, of another domain, or with a field out of form', () => {
    const bad: readonly unknown[] = [
      null,
      [],
      { ...vector, domain: 'teamrig-owner-proof/v0' },
      { ...vector, keyId: 1 },
      { ...vector, hostId: undefined },
      { ...vector, team: null },
      { ...vector, act: ['owner', 1] },
      { ...vector, commit: 7 },
      { ...vector, cardDigest: undefined },
      { ...vector, nonce: 'A'.repeat(64) },
      { ...vector, nonce: 'a'.repeat(63) },
      { ...vector, nonce: undefined },
      { ...vector, issuedAt: 'yesterday' },
      { ...vector, issuedAt: undefined },
      { ...vector, expires: 'later' },
      { ...vector, expires: undefined },
    ];
    for (const record of bad) assert.equal(parseChallenge(record), undefined, JSON.stringify(record));
  });

  it('takes only 64 lowercase hex digits as hex64', () => {
    assert.equal(isHex64('0123456789abcdef'.repeat(4)), true);
    assert.equal(isHex64('0123456789ABCDEF'.repeat(4)), false);
    assert.equal(isHex64(`${'a'.repeat(64)}\n`), false);
  });
});
