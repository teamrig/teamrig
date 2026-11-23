import { CREDENTIAL_NAME } from '../core/credentials.ts';

/** The prefix of the credential that holds an owner's token: `teamrig-gh-<owner>`, the owner in lowercase. */
export const TOKEN_PREFIX = 'teamrig-gh-';

/**
 * The credential the ship tool (tools/ship) reads its own GitHub token from, apart from the owners' tokens. Kept here
 * beside `TOKEN_PREFIX` so the secret guard refuses a session line naming either from one source.
 */
export const SHIP_TOKEN = 'teamrig-ship-gh';

/** The name of the credential `teamrig issue sync` looks for to read `owner`'s repositories. */
export function tokenName(owner: string): string {
  return `${TOKEN_PREFIX}${owner.toLowerCase()}`;
}

/** What a `teamrig key` command names: an owner or one of its repositories, and the credential its key is saved as. */
export interface KeyScope {
  /** `owner` or `owner/name`, in lowercase. */
  readonly scope: string;
  readonly credential: string;
}

/** A GitHub owner: letters, digits and single hyphens, at most 39 characters. */
const GITHUB_OWNER = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/iu;

/** A GitHub repository name: letters, digits, `.`, `_` and `-`, and never `.` or `..` alone. */
const GITHUB_REPO = /^(?!\.{1,2}$)[\w.-]{1,100}$/u;

/** The scope `text` names, `owner` or `owner/name`, or undefined when it is neither or its credential name would be no credential name. */
export function keyScopeOf(text: string): KeyScope | undefined {
  const [owner, name, ...rest] = text.split('/');
  if (owner === undefined || !GITHUB_OWNER.test(owner) || rest.length > 0) {
    return undefined;
  }
  if (name === undefined) {
    return { scope: owner.toLowerCase(), credential: tokenName(owner) };
  }
  const credential = GITHUB_REPO.test(name) ? repoTokenName(text) : undefined;
  return credential === undefined ? undefined : { scope: text.toLowerCase(), credential };
}

/**
 * The name of the credential that holds a key for the one repository `owner/name`: `teamrig-gh-<owner>.<name>`, in
 * lowercase. A GitHub owner never holds a `.`, so no repository's name meets an owner's. Undefined when `repo` is no
 * `owner/name` or the name would not be a credential name (a repository name long enough to pass 128 characters):
 * that repository is reached through its owner's key only.
 */
export function repoTokenName(repo: string): string | undefined {
  const [owner, name, ...rest] = repo.split('/');
  if (owner === undefined || owner === '' || name === undefined || name === '' || rest.length > 0) {
    return undefined;
  }
  const credential = `${tokenName(owner)}.${name.toLowerCase()}`;
  return CREDENTIAL_NAME.test(credential) ? credential : undefined;
}
