import { reviewPathMatcher } from "../push-guard/review-paths.js";
/** An `<owner>/<name>:` prefix, as GitHub names a repository, then the path glob. */
const REPO_PREFIX = /^([a-z0-9][a-z0-9-]{0,38}\/[a-z0-9._-]{1,100}):(.*)$/i;
export function splitAreaGlob(text) {
    const match = REPO_PREFIX.exec(text);
    const repo = match?.[1];
    const glob = match?.[2];
    return repo === undefined || glob === undefined ? { repo: undefined, glob: text } : { repo: repo.toLowerCase(), glob };
}
export class AreaMap {
    entries;
    constructor(github) {
        this.entries = Object.entries(github.areaOwners).flatMap(([label, session]) => (Object.hasOwn(github.areaPaths, label) ? (github.areaPaths[label] ?? []) : []).map((text) => {
            const { repo, glob } = splitAreaGlob(text);
            return { session, repo, matches: reviewPathMatcher(glob) };
        }));
    }
    /** Whether any area holds any path. */
    get isEmpty() {
        return this.entries.length === 0;
    }
    /** The sessions that own `path` of `repo` (`owner/name`, any case), in the order of `github.areaOwners`. */
    ownersOf(repo, path) {
        const lower = repo.toLowerCase();
        const owners = this.entries.filter((entry) => (entry.repo === undefined || entry.repo === lower) && entry.matches(path)).map((entry) => entry.session);
        return [...new Set(owners)];
    }
    /**
     * Every session owning an area of `repo` (`owner/name`, any case), once each, in the order of `github.areaOwners`:
     * who may own a change whose paths are not known.
     */
    sessionsOf(repo) {
        const lower = repo.toLowerCase();
        return [...new Set(this.entries.filter((entry) => entry.repo === undefined || entry.repo === lower).map((entry) => entry.session))];
    }
    /** Each owner of any of `paths` with the ones it owns, and the paths no area holds. */
    split(repo, paths) {
        const shares = new Map();
        const unowned = [];
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
        const owners = [...shares].map(([session, owned]) => ({ session, paths: owned })).sort((a, b) => order.indexOf(a.session) - order.indexOf(b.session));
        return { owners, unowned };
    }
}
