import { pickKey, repoTokenName, tokenName, } from "../../../plugin-api/index.js";
/**
 * The owner's saved key cannot be used, so the command stops for that owner. The gh login never stands in for it:
 * that login may reach far more repositories, with far more rights, than the key the team saved for the owner.
 */
export class NoAccessError extends Error {
}
/** The store holds an owner's credential but could not read it, such as a locked keyring. */
export class TokenReadError extends NoAccessError {
    name = 'TokenReadError';
    constructor(credential, label, reason, save) {
        super(`could not read ${credential} from ${label}: ${reason}; unlock the store and rerun, or save the key again with: ${save}`);
    }
}
/** No key is saved for the owner. */
export class TokenMissingError extends NoAccessError {
    name = 'TokenMissingError';
    constructor(owner, credential, label, save) {
        super(`no token for ${owner} is saved as ${credential} in ${label}; teamrig reaches a repository only with its owner's saved token, never the gh login: save one with: ${save}`);
    }
}
/** A call reaches several repositories of one owner, and one of them has a key of its own, which the owner's key would stand in for. */
export class OwnKeyError extends NoAccessError {
    name = 'OwnKeyError';
    constructor(repos, repo) {
        super(`it reaches ${repos.join(', ')}, and ${repo} has a key of its own, so the owner's key may not stand in for it; name one repository with \`-R <owner>/<name>\``);
    }
}
/** The owner of `owner/name`, in lowercase. */
export function repoOwner(repo) {
    return repo.slice(0, repo.indexOf('/')).toLowerCase();
}
/**
 * The access to each repository, picking the store once per target. A fine-grained GitHub token reaches the
 * repositories of one owner only, so a team that reads a personal account's and an organisation's repositories saves
 * one token for each, by name: no config names them. A key saved for one repository (`teamrig-gh-<owner>.<name>`)
 * reaches that repository ahead of its owner's, so a team can give one repository fewer or other rights. A target
 * with no saved key, or a narrower key the store could not read, gives a NoAccessError, which stops the command
 * there: a wider key never stands in.
 */
export class RepoTokens {
    store;
    env;
    picks = new Map();
    constructor(store, env) {
        this.store = store;
        this.env = env;
    }
    /** The access to `repo` through its own saved key, else its owner's, or the error that stops the command when there is none to use. */
    accessFor(repo) {
        const owner = repoOwner(repo);
        const credential = repoTokenName(repo);
        const narrow = credential === undefined ? [] : [{ scope: repo.toLowerCase(), credential }];
        return this.access(owner, [...narrow, ownerCandidate(owner)]);
    }
    /** The access to every repository of `owner` (any case) through its saved key, or the error that stops the command when there is none to use. */
    accessForOwner(name) {
        const owner = name.toLowerCase();
        return this.access(owner, [ownerCandidate(owner)]);
    }
    /**
     * The access to several repositories of `owner` at once through the owner's key, used only when none of them has a
     * key of its own: a repository key that is saved, or that the store could not read, refuses the call, since the
     * wider key would stand in for it.
     */
    async accessForRepos(name, repos) {
        const owner = name.toLowerCase();
        const narrow = repos.flatMap((repo) => {
            const credential = repoOwner(repo) === owner ? repoTokenName(repo) : undefined;
            return credential === undefined ? [] : [{ scope: repo.toLowerCase(), credential }];
        });
        const own = narrow.length === 0 ? { kind: 'missing' } : await pickKey(this.store, narrow);
        switch (own.kind) {
            case 'found':
                return new OwnKeyError(repos, own.scope);
            case 'failed':
                return new TokenReadError(own.credential, this.store.label, own.reason, this.store.saveCommand(own.credential));
            case 'missing':
                return this.accessForOwner(owner);
        }
    }
    async access(owner, candidates) {
        const pick = await this.pickOnce(candidates);
        switch (pick.kind) {
            case 'found':
                return {
                    env: { ...this.env, GH_TOKEN: pick.secret },
                    owner,
                    scope: pick.scope,
                    credential: pick.credential,
                    save: this.store.saveCommand(pick.credential),
                };
            case 'missing': {
                const credential = tokenName(owner);
                return new TokenMissingError(owner, credential, this.store.label, this.store.saveCommand(credential));
            }
            case 'failed':
                return new TokenReadError(pick.credential, this.store.label, pick.reason, this.store.saveCommand(pick.credential));
        }
    }
    pickOnce(candidates) {
        const key = candidates.map((candidate) => candidate.credential).join('\n');
        const known = this.picks.get(key);
        if (known !== undefined) {
            return known;
        }
        const pick = pickKey(this.store, candidates);
        this.picks.set(key, pick);
        return pick;
    }
}
function ownerCandidate(owner) {
    return { scope: owner, credential: tokenName(owner) };
}
