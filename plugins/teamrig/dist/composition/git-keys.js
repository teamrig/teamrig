import { githubGitAnswer, githubHelperScope } from "../adapters/connectors/github/git-credential.js";
import { RepoTokens } from "../adapters/connectors/github/tokens.js";
/**
 * The helper's keys, read from the credential store alone: no environment token stands in. The answer is the tracker
 * adapter's, and only this folder may reach an adapter, so a command takes it from here; a second host is one more
 * branch here.
 */
export function gitKeys(store) {
    const tokens = new RepoTokens(store, {});
    return {
        answer: async (ask) => await githubGitAnswer(ask, tokens),
        scopeOf: async (remoteUrl) => await githubHelperScope(remoteUrl, tokens),
    };
}
