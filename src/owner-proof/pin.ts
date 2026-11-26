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

const PEM = /^-----BEGIN PUBLIC KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)-----END PUBLIC KEY-----$/;

const SEQUENCE = 0x30;
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

/** The algorithm a SubjectPublicKeyInfo's identifier names, `other` for a key of none, undefined for bytes that are no SubjectPublicKeyInfo. */
function spkiAlgorithm(bytes: Uint8Array): SignatureAlgorithm | 'other' | undefined {
  const outer = derItem(bytes, 0);
  if (outer === undefined || outer.tag !== SEQUENCE || outer.end !== bytes.length) return undefined;
  const [identifier, key, ...rest] = derItems(outer.body) ?? [];
  if (identifier?.tag !== SEQUENCE || key?.tag !== BIT_STRING || key.body.length < 2 || rest.length > 0) return undefined;
  const [oid, params, ...more] = derItems(identifier.body) ?? [];
  if (oid?.tag !== OBJECT_ID || more.length > 0) return undefined;
  if (sameBytes(oid.body, RSA_ENCRYPTION)) return params?.tag === NULL && params.body.length === 0 ? 'rsa-pkcs1-sha256' : 'other';
  if (sameBytes(oid.body, EC_PUBLIC_KEY)) return params?.tag === OBJECT_ID && sameBytes(params.body, SECP256R1) ? 'ecdsa-p256-sha256' : 'other';
  if (sameBytes(oid.body, ED25519)) return params === undefined ? 'ed25519' : 'other';
  return 'other';
}

/**
 * Why a pinned public key cannot verify anything, or undefined when it is a PEM SubjectPublicKeyInfo of its algorithm's
 * kind and, for EC, curve. It reads the key's DER with no node: module, so the config that holds the pins stays readable
 * without Node built-ins; the verifier checks the key again with node:crypto before it trusts a signature.
 */
export function pinKeyProblem(publicKeyPem: string, algorithm: SignatureAlgorithm): string | undefined {
  const body = PEM.exec(publicKeyPem.trim())?.[1];
  const bytes = body === undefined ? undefined : base64Bytes(body.replace(/\r?\n/g, ''));
  const named = bytes === undefined ? undefined : spkiAlgorithm(bytes);
  if (named === undefined) return 'expected a PEM public key';
  return named === algorithm ? undefined : `expected a public key of the ${algorithm} kind`;
}
