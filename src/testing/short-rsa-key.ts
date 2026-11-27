import { createPublicKey, type KeyObject } from 'node:crypto';

/**
 * An RSA public key of `bits` bits read from a fixed modulus, never generated: a spec that proves a short key is
 * refused needs only its public half, and creating a weak key pair is what code scanning rightly flags.
 */
export function shortRsaPublicKey(bits: number): KeyObject {
  if (bits % 8 !== 0 || bits < 512) throw new RangeError(`shortRsaPublicKey takes a whole number of bytes from 512 bits (got ${bits})`);
  // Odd bytes make an odd modulus, as every RSA one is; the top bit set gives it exactly `bits` bits.
  const modulus = Buffer.alloc(bits / 8, 0xab);
  modulus[0] = 0xc1;
  return createPublicKey({ key: { kty: 'RSA', n: modulus.toString('base64url'), e: 'AQAB' }, format: 'jwk' });
}
