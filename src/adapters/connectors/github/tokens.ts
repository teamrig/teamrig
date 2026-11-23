import {
  pickKey, repoTokenName, tokenName, type CredentialStore, type Env, type KeyCandidate, type KeyPick,
} from '../../../plugin-api/index.ts';

/**
 * How a command reaches one repository: through the key saved for that repository alone, else the one saved for its
 * owner, which gh gets as `GH_TOKEN` for that run only. The secret is never printed.
 */
export interface RepoAccess {
  /** The environment gh runs with, `GH_TOKEN` set to the picked key. */
  readonly env: Env;
  /** The repository's owner, in lowercase. */
  readonly owner: string;
  /** What the picked key covers: `owner/name` for a repository's own key, `owner` for the owner's, in lowercase. */
  readonly scope: string;
  /** The credential that holds the picked key. */
  readonly credential: string;
  /** The command that saves that credential, for a message that says how. */
  readonly save: string;
}

/**
 * The owner's saved key cannot be used, so the command stops for that owner. The gh login never stands in for it:
 * that login may reach far more repositories, with far more rights, than the key the team saved for the owner.
 */
export abstract class NoAccessError extends Error {}

/** The store holds an owner's credential but could not read it, such as a locked keyring. */
export class TokenReadError extends NoAccessError {
  override readonly name = 'TokenReadError';

  constructor(credential: string, label: string, reason: string, save: string) {
    super(`could not read ${credential} from ${label}: ${reason}; unlock the store and rerun, or save the key again with: ${save}`);
  }
}

/** No key is saved for the owner. */
export class TokenMissingError extends NoAccessError {
  override readonly name = 'TokenMissingError';

  constructor(owner: string, credential: string, label: string, save: string) {
    super(`no token for ${owner} is saved as ${credential} in ${label}; teamrig reaches a repository only with its owner's saved token, never the gh login: save one with: ${save}`);
  }
}

/** The owner of `owner/name`, in lowercase. */
export function repoOwner(repo: string): string {
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
  private readonly store: CredentialStore;
  private readonly env: Env;
  private readonly picks = new Map<string, Promise<KeyPick>>();

  constructor(store: CredentialStore, env: Env) {
    this.store = store;
    this.env = env;
  }

  /** The access to `repo` through its own saved key, else its owner's, or the error that stops the command when there is none to use. */
  accessFor(repo: string): Promise<RepoAccess | NoAccessError> {
    const owner = repoOwner(repo);
    const credential = repoTokenName(repo);
    const narrow: KeyCandidate[] = credential === undefined ? [] : [{ scope: repo.toLowerCase(), credential }];
    return this.access(owner, [...narrow, ownerCandidate(owner)]);
  }

  /** The access to every repository of `owner` (any case) through its saved key, or the error that stops the command when there is none to use. */
  accessForOwner(name: string): Promise<RepoAccess | NoAccessError> {
    const owner = name.toLowerCase();
    return this.access(owner, [ownerCandidate(owner)]);
  }

  private async access(owner: string, candidates: readonly KeyCandidate[]): Promise<RepoAccess | NoAccessError> {
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

  private pickOnce(candidates: readonly KeyCandidate[]): Promise<KeyPick> {
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

function ownerCandidate(owner: string): KeyCandidate {
  return { scope: owner, credential: tokenName(owner) };
}
