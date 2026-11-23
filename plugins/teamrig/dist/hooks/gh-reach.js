import { apiEndpointOf, apiRepoOf, endpointPath, ghCommandSlotOf, ghGroupKind, mayResolveElsewhere, repoFlagsOf, repoValueOf } from "./gh-writes.js";
const FOLDER = { kind: 'folder' };
/** A GitHub owner's name: letters, digits and dashes. */
const OWNER_NAME = /^[a-z\d][a-z\d-]{0,38}$/iu;
/** The `gh api` paths whose second part is an owner: `orgs/<owner>/...`, `users/<owner>/...`. */
const OWNER_PATHS = new Set(['orgs', 'users']);
/** The hosts a full `gh api` URL may reach: a key saved for github.com goes nowhere else. */
const GITHUB_HOSTS = new Set(['github.com', 'api.github.com']);
/** The hosts a `-R`, `gh repo` or `GH_REPO` value may name: gh sends `GH_TOKEN` to any GitHub host it names, such as a `*.ghe.com` tenant. */
const REPO_HOSTS = new Set(['github.com', 'www.github.com']);
/** The `gh repo` commands that take the repository as a word of their own (`gh repo view acme/web`). */
const REPO_POSITIONAL = new Set(['view', 'clone', 'edit', 'delete', 'fork', 'archive', 'unarchive', 'sync']);
function refused(why) {
    return { kind: 'refused', why };
}
/** Why a repository value's host is refused, or undefined for github.com or a value with no host. */
export function repoHostRefusal(host, where) {
    return host === undefined || REPO_HOSTS.has(host) ? undefined : `${where} names the host ${host}, and the saved keys are for github.com`;
}
/** The owner of an `owner/name` repository, lowercase. */
export function ownerOfRepo(repo) {
    return repo.slice(0, repo.indexOf('/')).toLowerCase();
}
/** The target an `owner/name` repository is. */
export function repoTarget(repo) {
    return { owner: ownerOfRepo(repo), repo: repo.toLowerCase() };
}
function targetsOf(repos) {
    return { kind: 'targets', targets: repos.map(repoTarget) };
}
/** The host a full URL reaches, lowercase; undefined for a path. */
function urlHostOf(text) {
    const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:?#]*)/iu.exec(text);
    return match === null ? undefined : (match[1] ?? '').toLowerCase();
}
/** What a `gh api` call reaches: by its path, else the folder's. */
function apiReach(rest) {
    if (rest.some((word) => word.text === '--hostname' || word.text.startsWith('--hostname='))) {
        return refused('`--hostname` reaches another GitHub host, and the saved keys are for github.com');
    }
    const endpoint = apiEndpointOf(rest);
    if (endpoint === undefined) {
        return FOLDER;
    }
    const host = urlHostOf(endpoint.text);
    if (host !== undefined && !GITHUB_HOSTS.has(host)) {
        return refused(`its URL reaches ${host === '' ? 'no host' : host}, and the saved keys are for github.com`);
    }
    const path = endpointPath(endpoint.text);
    if (mayResolveElsewhere(path)) {
        return refused('its path has a `.`, `..` or `%` segment, which may reach another repository than the one whose key teamrig would pick');
    }
    const repo = apiRepoOf(path);
    if (repo === 'folder') {
        return FOLDER;
    }
    if (repo !== undefined) {
        return targetsOf([repo]);
    }
    const [first, owner] = path.split('/');
    if (first === 'repos') {
        return refused('its `repos/` path names no repository teamrig can read; write it as `repos/<owner>/<name>/...`');
    }
    return first !== undefined && OWNER_PATHS.has(first) && owner !== undefined && OWNER_NAME.test(owner)
        ? { kind: 'targets', targets: [{ owner: owner.toLowerCase(), repo: undefined }] }
        : FOLDER;
}
/** What a group's call reaches: its `-R` values, a `gh repo` command's repository word, else the folder's. */
function groupReach(group, rest) {
    const flags = repoFlagsOf(rest);
    if (flags === undefined) {
        return refused('its `-R` value names no repository');
    }
    if (flags.given) {
        const offHost = flags.hosts.map((host) => repoHostRefusal(host, 'its `-R` value')).find((why) => why !== undefined);
        return offHost === undefined ? targetsOf(flags.repos) : refused(offHost);
    }
    if (group !== 'repo') {
        return FOLDER;
    }
    const slot = ghCommandSlotOf(rest);
    if (slot.kind !== 'command' || slot.command === undefined || !REPO_POSITIONAL.has(slot.command.text)) {
        return FOLDER;
    }
    const value = slot.rest.flatMap((word) => {
        const named = word.text.startsWith('-') ? undefined : repoValueOf(word.text);
        return named === undefined ? [] : [named];
    })[0];
    if (value === undefined) {
        return FOLDER;
    }
    const offHost = repoHostRefusal(value.host, `its repository \`${value.repo}\``);
    return offHost === undefined ? targetsOf([value.repo]) : refused(offHost);
}
/** What a call's words (after `gh`) name, or that the folder picks; a group teamrig will not run with a key is refused. */
export function ghReachOf(words) {
    const [group] = words;
    if (group === undefined) {
        return refused('it names no gh command: give one after `--`, such as `teamrig gh -- pr view 5 -R owner/name`');
    }
    if (group.text.startsWith('-')) {
        return refused('gh takes no flag before its command here');
    }
    const kind = ghGroupKind(group.text);
    if (kind === 'local') {
        return refused(`\`gh ${group.text}\` changes gh's own login, settings, aliases or extensions, or prints its key; run it outside teamrig gh`);
    }
    if (kind === 'other') {
        return refused(`\`gh ${group.text}\` is no gh command, so an alias or an extension, which would run code holding the key`);
    }
    return group.text === 'api' ? apiReach(words.slice(1)) : groupReach(group.text, words.slice(1));
}
