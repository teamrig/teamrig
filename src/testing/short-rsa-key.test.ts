import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shortRsaPublicKey } from './short-rsa-key.ts';

describe('shortRsaPublicKey', () => {
  it('reads an RSA public key of exactly the bits asked', () => {
    for (const bits of [1024, 2040]) {
      const key = shortRsaPublicKey(bits);
      assert.equal(key.asymmetricKeyType, 'rsa');
      assert.equal(key.type, 'public');
      assert.equal(key.asymmetricKeyDetails?.modulusLength, bits);
    }
  });

  it('refuses a size that is no whole number of bytes or under 512 bits', () => {
    assert.throws(() => shortRsaPublicKey(1023), RangeError);
    assert.throws(() => shortRsaPublicKey(256), RangeError);
  });
});
