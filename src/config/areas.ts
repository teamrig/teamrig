import { reviewPathMatcher } from '../push-guard/review-paths.ts';
import type { GithubConfig } from './types.ts';

/**
 * The paths of each area (`github.areaPaths`, T3187), owned by the session `github.areaOwners` names for its label: the
 * one owner map an issue's label and a pull request's paths both go by. An outside pull request's review goes to the
 * owners of the paths it changes, as each knows its own code best; a path no area holds is nobody's here, and the caller
 * reviews it. A path two areas hold is both owners': each reviews it.
 */

/** One area glob read apart: the repository it holds to (lowercase), if it names one, and its path glob. */
export interface AreaGlob {
  readonly repo: string | undefined;
  readonly glob: string;
}

/** An `<owner>/<name>:` prefix, as GitHub names a repository, then the path glob. */
const REPO_PREFIX = /^([a-z0-9][a-z0-9-]{0,38}\/[a-z0-9._-]{1,100}):(.*)$/i;

export function splitAreaGlob(text: string): AreaGlob {
  const match = REPO_PREFIX.exec(text);
  const repo = match?.[1];
  const glob = match?.[2];
  return repo === undefined || glob === undefined ? { repo: undefined, glob: text } : { repo: repo.toLowerCase(), glob };
}

/** One owning session with the paths it owns, of those asked about, in their order. */
export interface AreaShare {
  readonly session: string;
  readonly paths: readonly string[];
}

/** The owners of a set of paths, in the order of `github.areaOwners`, and the paths no area holds. */
export interface AreaSplit {
  readonly owners: readonly AreaShare[];
  readonly unowned: readonly string[];
}

interface AreaEntry {
  readonly session: string;
  readonly repo: string | undefined;
  readonly matches: (path: string) => boolean;
}

export class AreaMap {
  private readonly entries: readonly AreaEntry[];

  constructor(github: Pick<GithubConfig, 'areaOwners' | 'areaPaths'>) {
    this.entries = Object.entries(github.areaOwners).flatMap(([label, session]) =>
      (Object.hasOwn(github.areaPaths, label) ? (github.areaPaths[label] ?? []) : []).map((text): AreaEntry => {
        const { repo, glob } = splitAreaGlob(text);
        return { session, repo, matches: reviewPathMatcher(glob) };
      }),
    );
  }

  /** Whether any area holds any path. */
  get isEmpty(): boolean {
    return this.entries.length === 0;
  }

  /** The sessions that own `path` of `repo` (`owner/name`, any case), in the order of `github.areaOwners`. */
  ownersOf(repo: string, path: string): readonly string[] {
    const lower = repo.toLowerCase();
    const owners = this.entries.filter((entry) => (entry.repo === undefined || entry.repo === lower) && entry.matches(path)).map((entry) => entry.session);
    return [...new Set(owners)];
  }

  /**
   * Every session owning an area of `repo` (`owner/name`, any case), once each, in the order of `github.areaOwners`:
   * who may own a change whose paths are not known.
   */
  sessionsOf(repo: string): readonly string[] {
    const lower = repo.toLowerCase();
    return [...new Set(this.entries.filter((entry) => entry.repo === undefined || entry.repo === lower).map((entry) => entry.session))];
  }

  /** Each owner of any of `paths` with the ones it owns, and the paths no area holds. */
  split(repo: string, paths: readonly string[]): AreaSplit {
    const shares = new Map<string, string[]>();
    const unowned: string[] = [];
    for (const path of paths) {
      const owners = this.ownersOf(repo, path);
      if (owners.length === 0) {
        unowned.push(path);
      }
      for (const session of owners) {
        shares.set(session, [...(shares.get(session) ?? []), path]);
      }
    }
    const order = this.entries.map((entry) => entry.session);
    const owners = [...shares].map(([session, owned]): AreaShare => ({ session, paths: owned })).sort((a, b) => order.indexOf(a.session) - order.indexOf(b.session));
    return { owners, unowned };
  }
}
