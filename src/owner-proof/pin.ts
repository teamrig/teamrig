/**
 * The signature schemes a pinned key may use. The verifier takes the one stored with the pin, never one a proof record
 * names (T4758 security read, C3). rsa-pkcs1-sha256 is Windows Hello's KeyCredential; ecdsa-p256-sha256 a Secure Enclave key;
 * ed25519 a key a root-owned helper holds.
 */
export const SIGNATURE_ALGORITHMS = ['rsa-pkcs1-sha256', 'ecdsa-p256-sha256', 'ed25519'] as const;

export type SignatureAlgorithm = (typeof SIGNATURE_ALGORITHMS)[number];

export function isSignatureAlgorithm(value: unknown): value is SignatureAlgorithm {
  return SIGNATURE_ALGORITHMS.some((algorithm) => algorithm === value);
}

/** The owner's enrolled public key as the pin keeps it. */
export interface PinnedKey {
  readonly keyId: string;
  readonly algorithm: SignatureAlgorithm;
  readonly publicKeyPem: string;
}

/** The smallest RSA modulus a pin may have, in bits: NIST SP 800-57's floor for a signature key (security T5737, O1). */
export const RSA_MIN_MODULUS_BITS = 2048;

const PEM = /^-----BEGIN PUBLIC KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)-----END PUBLIC KEY-----$/;

const SEQUENCE = 0x30;
const INTEGER = 0x02;
const BIT_STRING = 0x03;
const OBJECT_ID = 0x06;
const NULL = 0x05;

/** The DER bytes of each algorithm's object identifiers: RFC 8017 rsaEncryption, RFC 5480 id-ecPublicKey and secp256r1, RFC 8410 id-Ed25519. */
const RSA_ENCRYPTION = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];
const EC_PUBLIC_KEY = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];
const SECP256R1 = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];
const ED25519 = [0x2b, 0x65, 0x70];

interface DerItem {
  readonly tag: number;
  readonly body: Uint8Array;
  readonly end: number;
}

/** One DER item at `at`, its length in short or long form (at most 3 length bytes), or undefined when it runs past the bytes. */
function derItem(bytes: Uint8Array, at: number): DerItem | undefined {
  const tag = bytes[at];
  const first = bytes[at + 1];
  if (tag === undefined || first === undefined) return undefined;
  let length = first;
  let start = at + 2;
  if (first >= 0x80) {
    const count = first - 0x80;
    if (count === 0 || count > 3) return undefined;
    length = 0;
    for (let index = 0; index < count; index += 1) {
      const byte = bytes[start + index];
      if (byte === undefined) return undefined;
      length = length * 256 + byte;
    }
    start += count;
  }
  const end = start + length;
  return end > bytes.length ? undefined : { tag, body: bytes.subarray(start, end), end };
}

/** The items that fill `bytes` exactly, or undefined when one is cut short. */
function derItems(bytes: Uint8Array): readonly DerItem[] | undefined {
  const items: DerItem[] = [];
  for (let at = 0; at < bytes.length; ) {
    const item = derItem(bytes, at);
    if (item === undefined) return undefined;
    items.push(item);
    at = item.end;
  }
  return items;
}

function sameBytes(bytes: Uint8Array, expected: readonly number[]): boolean {
  return bytes.length === expected.length && expected.every((byte, index) => bytes[index] === byte);
}

function base64Bytes(text: string): Uint8Array | undefined {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/** A SubjectPublicKeyInfo read: the algorithm its identifier names (`other` for none listed) and its key's BIT STRING body. */
interface Spki {
  readonly named: SignatureAlgorithm | 'other';
  readonly key: Uint8Array;
}

function namedAlgorithm(oid: Uint8Array, params: DerItem | undefined): SignatureAlgorithm | 'other' {
  if (sameBytes(oid, RSA_ENCRYPTION)) return params?.tag === NULL && params.body.length === 0 ? 'rsa-pkcs1-sha256' : 'other';
  if (sameBytes(oid, EC_PUBLIC_KEY)) return params?.tag === OBJECT_ID && sameBytes(params.body, SECP256R1) ? 'ecdsa-p256-sha256' : 'other';
  if (sameBytes(oid, ED25519)) return params === undefined ? 'ed25519' : 'other';
  return 'other';
}

/** The SubjectPublicKeyInfo `bytes` hold exactly, or undefined for bytes that are none. */
function spkiOf(bytes: Uint8Array): Spki | undefined {
  const outer = derItem(bytes, 0);
  if (outer === undefined || outer.tag !== SEQUENCE || outer.end !== bytes.length) return undefined;
  const [identifier, key, ...rest] = derItems(outer.body) ?? [];
  if (identifier?.tag !== SEQUENCE || key?.tag !== BIT_STRING || key.body.length < 2 || rest.length > 0) return undefined;
  const [oid, params, ...more] = derItems(identifier.body) ?? [];
  if (oid?.tag !== OBJECT_ID || more.length > 0) return undefined;
  return { named: namedAlgorithm(oid.body, params), key: key.body };
}

/** The bits of a positive INTEGER's value: its leading zero bytes and leading zero bits not counted. */
function integerBits(body: Uint8Array): number {
  const first = body.findIndex((byte) => byte !== 0);
  if (first === -1) return 0;
  const top = body[first] ?? 0;
  return (body.length - first - 1) * 8 + (32 - Math.clz32(top));
}

/**
 * The modulus size of an RSA key's BIT STRING body (RFC 8017 RSAPublicKey: a SEQUENCE of the modulus and the public
 * exponent, both positive INTEGERs), or undefined when it holds no such key.
 */
function rsaModulusBits(key: Uint8Array): number | undefined {
  if (key[0] !== 0) return undefined;
  const body = key.subarray(1);
  const outer = derItem(body, 0);
  if (outer === undefined || outer.tag !== SEQUENCE || outer.end !== body.length) return undefined;
  const [modulus, exponent, ...rest] = derItems(outer.body) ?? [];
  if (modulus?.tag !== INTEGER || exponent?.tag !== INTEGER || rest.length > 0) return undefined;
  // A DER INTEGER with its top bit set is negative; a modulus or exponent never is.
  for (const value of [modulus, exponent]) if (((value.body[0] ?? 0x80) & 0x80) !== 0) return undefined;
  return integerBits(modulus.body);
}

/**
 * Why a pinned public key cannot verify anything, or undefined when it is a PEM SubjectPublicKeyInfo of its algorithm's
 * kind and, for EC, curve, and an RSA key's modulus is at least RSA_MIN_MODULUS_BITS. It reads the key's DER with no
 * node: module, so the config that holds the pins stays readable without Node built-ins; the verifier checks the key
 * again with node:crypto before it trusts a signature.
 */
export function pinKeyProblem(publicKeyPem: string, algorithm: SignatureAlgorithm): string | undefined {
  const body = PEM.exec(publicKeyPem.trim())?.[1];
  const bytes = body === undefined ? undefined : base64Bytes(body.replace(/\r?\n/g, ''));
  const spki = bytes === undefined ? undefined : spkiOf(bytes);
  if (spki === undefined) return 'expected a PEM public key';
  if (spki.named !== algorithm) return `expected a public key of the ${algorithm} kind`;
  if (algorithm !== 'rsa-pkcs1-sha256') return undefined;
  const bits = rsaModulusBits(spki.key);
  if (bits === undefined) return 'expected a PEM public key';
  return bits >= RSA_MIN_MODULUS_BITS ? undefined : `expected an RSA key of at least ${RSA_MIN_MODULUS_BITS} bits (got ${bits})`;
}
