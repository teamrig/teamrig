/**
 * git's credential helper protocol (git-credential(1)), as a helper reads and answers it: git writes `key=value`
 * lines, ended by a blank line or the end of input, and reads the helper's lines back the same way. Provider-neutral:
 * which host and path get which key is the caller's.
 */

/** The operations git asks a helper for, the word after the helper's own on its command line. */
export type CredentialOperation = 'get' | 'store' | 'erase';

/** What git asks a helper to answer: the URL's parts, each as git wrote it. */
export interface CredentialAsk {
  readonly protocol: string | undefined;
  readonly host: string | undefined;
  /** The URL's path with no leading `/`, sent only with `credential.useHttpPath` on. */
  readonly path: string | undefined;
  /** A user name the URL held (`https://name@host/...`). */
  readonly username: string | undefined;
}

export type CredentialRequest = { readonly kind: 'ask'; readonly ask: CredentialAsk } | { readonly kind: 'refused'; readonly why: string };

/**
 * The keys git (2.39 to 2.47) writes to a helper. A key ending in `[]` may come more than once; any other only once.
 * A key outside this list is refused, so a value can never smuggle a line the helper did not expect.
 */
const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'protocol',
  'host',
  'path',
  'username',
  'password',
  'password_expiry_utc',
  'oauth_refresh_token',
  'url',
  'authtype',
  'credential',
  'ephemeral',
  'continue',
  'wwwauth[]',
  'capability[]',
  'state[]',
]);

/** The operation named by a helper's first argument, or undefined for any other word. */
export function credentialOperationOf(word: string | undefined): CredentialOperation | undefined {
  return word === 'get' || word === 'store' || word === 'erase' ? word : undefined;
}

/**
 * Reads what git wrote. Refused: a carriage return or NUL anywhere, a line with no `=`, an unknown key, or a
 * single-valued key given twice; each is input git itself never writes.
 */
export function parseCredentialRequest(text: string): CredentialRequest {
  if (text.includes('\r') || text.includes('\0')) {
    return { kind: 'refused', why: 'the request holds a carriage return or NUL' };
  }
  const values = new Map<string, string>();
  for (const line of text.split('\n')) {
    if (line === '') {
      break;
    }
    const equals = line.indexOf('=');
    if (equals <= 0) {
      return { kind: 'refused', why: 'a request line is not key=value' };
    }
    const key = line.slice(0, equals);
    if (!KNOWN_KEYS.has(key)) {
      return { kind: 'refused', why: `the request holds the unknown key ${key}` };
    }
    if (key.endsWith('[]')) {
      continue;
    }
    if (values.has(key)) {
      return { kind: 'refused', why: `the request gives ${key} twice` };
    }
    values.set(key, line.slice(equals + 1));
  }
  return { kind: 'ask', ask: { protocol: values.get('protocol'), host: values.get('host'), path: values.get('path'), username: values.get('username') } };
}

/** A value that cannot end its line early or add one: no CR, LF or NUL. */
const ONE_LINE = /^[^\r\n\0]+$/u;

/**
 * The answer that gives git a key: a user name and the key as its password; undefined when either is empty or holds
 * a CR, LF or NUL, which would add a line of its own to the answer.
 */
export function credentialAnswer(username: string, password: string): string | undefined {
  return ONE_LINE.test(username) && ONE_LINE.test(password) ? `username=${username}\npassword=${password}\n` : undefined;
}

/** The answer that gives git no key and stops it asking any later helper, or the person, for one. */
export const CREDENTIAL_QUIT = 'quit=1\n';

/** Where a helper answers: the URL prefix git's `credential.<url>.*` keys take, such as `https://host`. */
export interface HelperScope {
  readonly urlPrefix: string;
  /** Who the key is saved for, as the line that reports the wiring names it. */
  readonly owner: string;
}

/** Why a helper serves no scope for a remote URL: git there is left as it was. */
export interface HelperSkip {
  readonly skip: string;
}
