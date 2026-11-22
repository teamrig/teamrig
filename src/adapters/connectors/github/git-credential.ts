import { CREDENTIAL_QUIT, credentialAnswer, type CredentialAsk, type HelperScope, type HelperSkip } from '../../../core/git-credential.ts';
import { NoAccessError, type RepoTokens } from './tokens.ts';

/** The user name GitHub takes with a token as the password over https. */
export const GITHUB_GIT_USER = 'x-access-token';

/** The host the saved keys are for; git asks with the URL's host, compared whole, never as a suffix. */
const GITHUB_HOST = 'github.com';

/** A GitHub owner: letters, digits and `-`. */
const OWNER = /^[A-Za-z0-9-]+$/u;
/** A GitHub repository name: letters, digits, `.`, `_` and `-`, and never only dots. */
const NAME = /^[\w.-]+$/u;

/** What the helper writes back to git, and the line it says on stderr when it gives no key. */
export interface GitAnswer {
  readonly stdout: string;
  readonly note: string | undefined;
}

/**
 * The `owner/name` git sent as the URL's path: a trailing `/` and `.git` dropped, the owner in lowercase; undefined
 * for any other path (more or fewer parts, `..`, percent-encoding).
 */
export function repoOfGitPath(path: string): { readonly owner: string; readonly name: string } | undefined {
  const bare = path.replace(/\/$/u, '').replace(/\.git$/u, '');
  const parts = bare.split('/');
  if (parts.length !== 2) {
    return undefined;
  }
  const [owner, name] = parts;
  if (owner === undefined || name === undefined || !OWNER.test(owner) || !NAME.test(name) || /^\.+$/u.test(name)) {
    return undefined;
  }
  return { owner: owner.toLowerCase(), name };
}

/**
 * The answer to git's `get`: the key saved for the repository's owner, only for `https` to github.com itself with the
 * repository's path (`credential.useHttpPath`) and no user name in the URL. Anything else, or an owner with no key
 * the store could read, answers `quit=1`: no key, and no later helper or prompt asked for one, so the machine's own
 * login never stands in.
 */
export async function githubGitAnswer(ask: CredentialAsk, keys: Pick<RepoTokens, 'accessForOwner'>): Promise<GitAnswer> {
  if (ask.protocol !== 'https') {
    return quit(`teamrig answers https only, not ${ask.protocol ?? 'no protocol'}`);
  }
  if (ask.host?.toLowerCase() !== GITHUB_HOST) {
    return quit(`the saved keys are for ${GITHUB_HOST}, not ${ask.host ?? 'no host'}`);
  }
  if (ask.username !== undefined) {
    return quit('the URL names a user; give it as https://github.com/<owner>/<name>');
  }
  if (ask.path === undefined) {
    return quit('git sent no repository path: set credential.https://github.com.useHttpPath true');
  }
  const repo = repoOfGitPath(ask.path);
  if (repo === undefined) {
    return quit(`git asked for ${ask.path}, which is no <owner>/<name> repository path`);
  }
  const access = await keys.accessForOwner(repo.owner);
  if (access instanceof NoAccessError) {
    return quit(access.message);
  }
  const key = access.env['GH_TOKEN'];
  const answer = key === undefined ? undefined : credentialAnswer(GITHUB_GIT_USER, key);
  return answer === undefined ? quit(`the key saved as ${access.credential} is no single line of text: save it again with: ${access.save}`) : { stdout: answer, note: undefined };
}

/**
 * Where teamrig's git helper answers for a remote URL: `https://github.com`, when the URL is https to github.com itself
 * (no user, password or port), names an `<owner>/<name>` repository, and the store holds a key for its owner. Any
 * other URL, or an owner with no key, is skipped, so git there keeps the helper it had: wiring a helper that could only
 * answer `quit=1` would break a push that works today.
 */
export async function githubHelperScope(remoteUrl: string, keys: Pick<RepoTokens, 'accessForOwner'>): Promise<HelperScope | HelperSkip> {
  // The raw prefix too: URL drops a default `:443`, which git would still send as the host, so the helper would quit there.
  const url = URL.canParse(remoteUrl) && remoteUrl.toLowerCase().startsWith(`https://${GITHUB_HOST}/`) ? new URL(remoteUrl) : undefined;
  if (url === undefined || url.protocol !== 'https:' || url.hostname !== GITHUB_HOST || url.port !== '' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    return { skip: `origin ${remoteUrl} is no https://${GITHUB_HOST}/<owner>/<name> URL` };
  }
  const repo = repoOfGitPath(url.pathname.slice(1));
  if (repo === undefined) {
    return { skip: `origin ${remoteUrl} names no <owner>/<name> repository` };
  }
  const access = await keys.accessForOwner(repo.owner);
  if (access instanceof NoAccessError) {
    return { skip: access.message };
  }
  return { urlPrefix: `https://${GITHUB_HOST}`, owner: repo.owner };
}

function quit(why: string): GitAnswer {
  return { stdout: CREDENTIAL_QUIT, note: `teamrig git-credential: no key given: ${why}` };
}
