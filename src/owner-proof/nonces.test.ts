import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isHex64 } from './challenge.ts';
import { issueNonce, newNonce, nonceState, pruneNonces, useNonce, type NonceEntry } from './nonces.ts';

const first = { nonce: 'a'.repeat(64), actDigest: 'f'.repeat(64), expires: 1_000 };

describe('owner proof nonces', () => {
  it('makes a nonce of 32 random bytes as 64 hex digits', () => {
    assert.equal(isHex64(newNonce()), true);
    assert.equal(newNonce((size) => Buffer.alloc(size, 0xab)), 'ab'.repeat(32));
    assert.notEqual(newNonce(), newNonce());
  });

  it('knows an issued nonce by the act it is for, and none it never issued', () => {
    const entries = issueNonce([], first);
    assert.deepEqual(nonceState(entries, first.nonce), { kind: 'issued', actDigest: first.actDigest });
    assert.deepEqual(nonceState(entries, 'b'.repeat(64)), { kind: 'unknown' });
  });

  it('refuses to issue a nonce twice', () => {
    assert.throws(() => issueNonce(issueNonce([], first), { ...first, actDigest: 'e'.repeat(64) }), /issued before/u);
  });

  it('uses a nonce once: a second use, or a use of one never issued, is refused', () => {
    const issued = issueNonce([], first);
    const once = useNonce(issued, first.nonce);
    assert.equal(once.used, true);
    assert.deepEqual(nonceState(once.entries, first.nonce), { kind: 'used' });
    assert.deepEqual(issued, [{ ...first, used: false }]);
    const twice = useNonce(once.entries, first.nonce);
    assert.equal(twice.used, false);
    assert.equal(twice.entries, once.entries);
    assert.equal(useNonce(issued, 'b'.repeat(64)).used, false);
  });

  it('drops entries expired before now less the grace, and keeps the rest', () => {
    const later: NonceEntry = { nonce: 'b'.repeat(64), actDigest: first.actDigest, expires: 5_000, used: true };
    const entries = [...issueNonce([], first), later];
    assert.deepEqual(pruneNonces(entries, 1_000), [later]);
    assert.deepEqual(pruneNonces(entries, 999), entries);
    assert.deepEqual(pruneNonces(entries, 1_500, 600), entries);
  });
});
