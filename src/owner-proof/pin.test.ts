import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SIGNATURE_ALGORITHMS, isSignatureAlgorithm } from './pin.ts';

describe('isSignatureAlgorithm', () => {
  it('takes each listed algorithm and refuses anything else', () => {
    for (const algorithm of SIGNATURE_ALGORITHMS) assert.equal(isSignatureAlgorithm(algorithm), true);
    for (const other of ['rsa', 'ecdsa-p384-sha384', 7, undefined]) assert.equal(isSignatureAlgorithm(other), false);
  });
});
