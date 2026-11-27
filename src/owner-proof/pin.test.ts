import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, it } from 'node:test';
import { RSA_MIN_MODULUS_BITS, SIGNATURE_ALGORITHMS, isSignatureAlgorithm, pinKeyProblem, type SignatureAlgorithm } from './pin.ts';

function pem(key: KeyObject): string {
  return key.export({ type: 'spki', format: 'pem' }).toString();
}

function armour(der: Uint8Array): string {
  const lines = Buffer.from(der).toString('base64').match(/.{1,64}/g) ?? [];
  return ['-----BEGIN PUBLIC KEY-----', ...lines, '-----END PUBLIC KEY-----', ''].join('\n');
}

function der(key: KeyObject): Uint8Array {
  return key.export({ type: 'spki', format: 'der' });
}

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
const p256 = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey;
const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).publicKey;
const ed25519 = generateKeyPairSync('ed25519').publicKey;
const ed448 = generateKeyPairSync('ed448').publicKey;

const KINDS: readonly (readonly [KeyObject, SignatureAlgorithm])[] = [
  [rsa, 'rsa-pkcs1-sha256'],
  [p256, 'ecdsa-p256-sha256'],
  [ed25519, 'ed25519'],
];

describe('isSignatureAlgorithm', () => {
  it('takes each listed algorithm and refuses anything else', () => {
    for (const algorithm of SIGNATURE_ALGORITHMS) assert.equal(isSignatureAlgorithm(algorithm), true);
    for (const other of ['rsa', 'ecdsa-p384-sha384', 7, undefined]) assert.equal(isSignatureAlgorithm(other), false);
  });
});

describe('pinKeyProblem', () => {
  it('takes a public key of each algorithm kind, LF or CRLF, as node:crypto reads it', () => {
    for (const [key, algorithm] of KINDS) {
      assert.equal(pinKeyProblem(pem(key), algorithm), undefined);
      assert.equal(pinKeyProblem(pem(key).replaceAll('\n', '\r\n'), algorithm), undefined);
      assert.equal(createPublicKey(pem(key)).asymmetricKeyType, key.asymmetricKeyType);
    }
  });

  it('refuses a key of another kind or curve than its algorithm', () => {
    for (const [key, algorithm] of KINDS) {
      for (const other of SIGNATURE_ALGORITHMS.filter((candidate) => candidate !== algorithm)) {
        assert.equal(pinKeyProblem(pem(key), other), `expected a public key of the ${other} kind`);
      }
    }
    assert.equal(pinKeyProblem(pem(p384), 'ecdsa-p256-sha256'), 'expected a public key of the ecdsa-p256-sha256 kind');
    assert.equal(pinKeyProblem(pem(ed448), 'ed25519'), 'expected a public key of the ed25519 kind');
  });

  it('refuses text that is no PEM public key: other armour, a private key, bad base64', () => {
    const pkcs1 = rsa.export({ type: 'pkcs1', format: 'pem' }).toString();
    const secret = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    for (const text of ['not a key', '', pkcs1, secret, '-----BEGIN PUBLIC KEY-----\n!!!!\n-----END PUBLIC KEY-----']) {
      assert.equal(pinKeyProblem(text, 'ed25519'), 'expected a PEM public key');
    }
  });

  it('refuses DER that is cut short, runs on past its key or holds more than an identifier and a key', () => {
    const bytes = der(ed25519);
    const extended = new Uint8Array([...bytes, 0x00]);
    const cut = bytes.subarray(0, bytes.length - 1);
    // The outer SEQUENCE grown by a trailing NULL, so the items inside no longer are just an identifier and a key.
    const inner = bytes.subarray(2);
    const third = new Uint8Array([0x30, inner.length + 2, ...inner, 0x05, 0x00]);
    for (const shape of [extended, cut, third, new Uint8Array([0x30]), new Uint8Array([0x30, 0x84, 0, 0, 0, 1])]) {
      assert.equal(pinKeyProblem(armour(shape), 'ed25519'), 'expected a PEM public key');
    }
    assert.equal(pinKeyProblem(armour(bytes), 'ed25519'), undefined, 'the re-armoured key itself passes');
  });

  it('names a known identifier with the wrong parameters a key of another kind', () => {
    const spki = (identifier: readonly number[]): Uint8Array => {
      const body = [0x30, identifier.length, ...identifier, 0x03, 0x02, 0x00, 0x01];
      return new Uint8Array([0x30, body.length, ...body]);
    };
    const rsaOid = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];
    const ecOid = [0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];
    const edOid = [0x06, 0x03, 0x2b, 0x65, 0x70];
    const shapes: readonly (readonly [readonly number[], SignatureAlgorithm])[] = [
      [rsaOid, 'rsa-pkcs1-sha256'],
      [ecOid, 'ecdsa-p256-sha256'],
      [[...edOid, 0x05, 0x00], 'ed25519'],
    ];
    for (const [identifier, algorithm] of shapes) {
      assert.equal(pinKeyProblem(armour(spki(identifier)), algorithm), `expected a public key of the ${algorithm} kind`);
    }
    assert.equal(pinKeyProblem(armour(spki([0x05, 0x00])), 'ed25519'), 'expected a PEM public key', 'an identifier with no object id');
  });

  it('reads a long-form length, as an RSA key has', () => {
    assert.ok(der(rsa).length > 255);
    assert.equal(pinKeyProblem(armour(der(rsa)), 'rsa-pkcs1-sha256'), undefined);
  });
});

describe('pinKeyProblem on an RSA modulus (T5792)', () => {
  const rsaOf = (bits: number): KeyObject => generateKeyPairSync('rsa', { modulusLength: bits }).publicKey;

  it(`takes an RSA key of ${RSA_MIN_MODULUS_BITS} bits or more`, () => {
    assert.equal(RSA_MIN_MODULUS_BITS, 2048);
    for (const key of [rsa, rsaOf(3072), rsaOf(4096)]) assert.equal(pinKeyProblem(pem(key), 'rsa-pkcs1-sha256'), undefined);
  });

  it('refuses an RSA key under 2048 bits and names its size, the bound itself counted exactly', () => {
    for (const bits of [1024, 2040]) {
      assert.equal(pinKeyProblem(pem(rsaOf(bits)), 'rsa-pkcs1-sha256'), `expected an RSA key of at least 2048 bits (got ${bits})`);
    }
  });

  it('refuses an rsaEncryption identifier whose key is no RSAPublicKey: junk, a negative modulus, a third INTEGER', () => {
    const rsaIdentifier = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
    const spki = (key: readonly number[]): Uint8Array => {
      const bits = [0x03, key.length + 1, 0x00, ...key];
      const body = [...rsaIdentifier, ...bits];
      return new Uint8Array([0x30, body.length, ...body]);
    };
    const sequence = (...items: readonly (readonly number[])[]): number[] => [0x30, items.flat().length, ...items.flat()];
    const exponent = [0x02, 0x03, 0x01, 0x00, 0x01];
    const shapes = [
      [0x01],
      sequence([0x02, 0x02, 0x80, 0x01], exponent),
      sequence([0x02, 0x02, 0x00, 0x81], exponent, exponent),
      sequence([0x02, 0x02, 0x00, 0x81]),
    ];
    for (const shape of shapes) assert.equal(pinKeyProblem(armour(spki(shape)), 'rsa-pkcs1-sha256'), 'expected a PEM public key');
    assert.equal(
      pinKeyProblem(armour(spki(sequence([0x02, 0x02, 0x00, 0x81], exponent))), 'rsa-pkcs1-sha256'),
      'expected an RSA key of at least 2048 bits (got 8)',
      'the same shape well formed reads its 8-bit modulus',
    );
  });
});
