import { githubGitAnswer, githubHelperScope, type GitAnswer } from '../adapters/connectors/github/git-credential.ts';
import { RepoTokens } from '../adapters/connectors/github/tokens.ts';
import type { CredentialAsk, CredentialStore, HelperScope, HelperSkip } from '../plugin-api/index.ts';

/** teamrig's git credential helper over the saved keys: what it answers git's `get` with, and where it is wired. */
export interface GitKeys {
  answer(ask: CredentialAsk): Promise<GitAnswer>;
  scopeOf(remoteUrl: string): Promise<HelperScope | HelperSkip>;
}

/**
 * The helper's keys, read from the credential store alone: no environment token stands in. The answer is the tracker
 * adapter's, and only this folder may reach an adapter, so a command takes it from here; a second host is one more
 * branch here.
 */
export function gitKeys(store: CredentialStore): GitKeys {
  const tokens = new RepoTokens(store, {});
  return {
    answer: async (ask) => await githubGitAnswer(ask, tokens),
    scopeOf: async (remoteUrl) => await githubHelperScope(remoteUrl, tokens),
  };
}
