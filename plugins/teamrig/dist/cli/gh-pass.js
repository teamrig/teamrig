import { GH_PROGRAM } from "../adapters/connectors/github/gh.js";
import { NoAccessError } from "../adapters/connectors/github/tokens.js";
import { errorMessage } from "../core/guards.js";
import { ghRouteOf } from "../hooks/gh-routes.js";
import { apiEndpointOf, apiRepoOf, endpointPath, ghCallOf, ghCommandSlotOf, ghGroupKind, mayResolveElsewhere, remoteReposOf, repoFlagsOf, repoValueOf, } from "../hooks/gh-writes.js";
const FOLDER = { kind: 'folder' };
/** A GitHub owner's name: letters, digits and dashes. */
const OWNER_NAME = /^[a-z\d][a-z\d-]{0,38}$/iu;
/** The `gh api` paths whose second part is an owner: `orgs/<owner>/...`, `users/<owner>/...`. */
const OWNER_PATHS = new Set(['orgs', 'users']);
/** The hosts a full `gh api` URL may reach: a key saved for github.com goes nowhere else. */
const GITHUB_HOSTS = new Set(['github.com', 'api.github.com']);
/** The hosts a `-R`, `gh repo` or `GH_REPO` value may name: gh sends `GH_TOKEN` to any GitHub host it names, such as a `*.ghe.com` tenant. */
const REPO_HOSTS = new Set(['github.com', 'www.github.com']);
/** Why a repository value's host is refused, or undefined for github.com or a value with no host. */
function hostRefusal(host, where) {
    return host === undefined || REPO_HOSTS.has(host) ? undefined : `${where} names the host ${host}, and the saved keys are for github.com`;
}
/** The `gh repo` commands that take the repository as a word of their own (`gh repo view acme/web`). */
const REPO_POSITIONAL = new Set(['view', 'clone', 'edit', 'delete', 'fork', 'archive', 'unarchive', 'sync']);
/** The errors gh prints when the key it used lacks a right or is no longer good. */
const KEY_FAILURE = /HTTP 40[13]\b|Bad credentials|Resource not accessible|requires authentication/iu;
function refused(why) {
    return { kind: 'refused', why };
}
function ownerOfRepo(repo) {
    return repo.slice(0, repo.indexOf('/')).toLowerCase();
}
function repoTarget(repo) {
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
function apiNamed(rest) {
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
function groupNamed(group, rest) {
    const flags = repoFlagsOf(rest);
    if (flags === undefined) {
        return refused('its `-R` value names no repository');
    }
    if (flags.given) {
        const offHost = flags.hosts.map((host) => hostRefusal(host, 'its `-R` value')).find((why) => why !== undefined);
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
    const offHost = hostRefusal(value.host, `its repository \`${value.repo}\``);
    return offHost === undefined ? targetsOf([value.repo]) : refused(offHost);
}
/** What a call's words name, or that the folder picks; a group teamrig will not run with a key is refused. */
export function namedTargetsOf(words) {
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
    return group.text === 'api' ? apiNamed(words.slice(1)) : groupNamed(group.text, words.slice(1));
}
function folderReposOf(ports) {
    let read;
    return () => {
        read ??= (async () => {
            const ghRepo = ports.env['GH_REPO'];
            if (ghRepo !== undefined && ghRepo !== '') {
                const value = repoValueOf(ghRepo);
                return value === undefined || hostRefusal(value.host, 'GH_REPO') !== undefined ? undefined : [value.repo];
            }
            const listing = await ports.run({ program: 'git', args: ['-C', ports.cwd, 'remote', '-v'] }).catch(() => undefined);
            return listing === undefined || listing.end.kind !== 'exited' || listing.end.code !== 0 ? [] : remoteReposOf(listing.stdout);
        })();
        return read;
    };
}
/** The owner whose key the run uses and the repositories it reaches, or why there is none: every target must be of one owner. */
async function targetFor(named, folder) {
    if (named.kind === 'refused') {
        return named;
    }
    let targets = named.kind === 'targets' ? named.targets : [];
    if (named.kind === 'folder') {
        const repos = await folder();
        if (repos === undefined) {
            return refused('it reaches the repository of the folder (or `GH_REPO`), which teamrig cannot read: a remote reaches GitHub in a form it cannot read (an SSH alias, a port, a `*.ghe.com` host), or `GH_REPO` names none on github.com; name the repository with `-R <owner>/<name>`');
        }
        if (repos.length === 0) {
            return refused('it names no repository and the folder has no GitHub remote, so no owner to pick a key for; name the repository with `-R <owner>/<name>`');
        }
        targets = repos.map(repoTarget);
    }
    const unique = [...new Set(targets.map((target) => target.owner))];
    const [owner] = unique;
    if (owner === undefined) {
        return refused('it names no repository owner');
    }
    if (unique.length > 1) {
        return refused(`it reaches ${unique.join(', ')}: one run uses one owner's key; name one repository with \`-R <owner>/<name>\``);
    }
    const repos = [...new Set(targets.flatMap((target) => (target.repo === undefined ? [] : [target.repo])))];
    return { kind: 'target', owner, repos };
}
/** The key for the picked target: the one repository's own (else its owner's), the owner's, or the owner's for several repositories none of which has its own. */
function accessOf(picked, keys) {
    const [repo] = picked.repos;
    if (repo === undefined) {
        return keys.accessForOwner(picked.owner);
    }
    return picked.repos.length === 1 ? keys.accessFor(repo) : keys.accessForRepos(picked.owner, picked.repos);
}
/** Why a write is left to teamrig's own commands: it may land on one of the team's repositories. */
async function writeRefusal(words, github, folder) {
    const call = ghCallOf(words);
    if (call.kind === 'read' || github.kind === 'none') {
        return undefined;
    }
    const instead = `teamrig's own command checks who may write there: ${ghRouteOf(words)}`;
    if (github.kind === 'unknown') {
        return `\`${call.what}\` writes on GitHub, and ${github.why}, so teamrig cannot tell whether it reaches one of the team's repositories; fix the config. ${instead}`;
    }
    if (call.kind === 'unplaced') {
        return `\`${call.what}\` writes on GitHub, and ${call.why}, so teamrig cannot tell whether it reaches one of the team's repositories. ${instead}`;
    }
    const fromFolder = call.target.folder ? await folder() : [];
    const hit = [...new Set([...call.target.repos, ...(fromFolder ?? [])])].filter((repo) => github.repos.has(repo));
    return hit.length === 0 ? undefined : `\`${call.what}\` writes on ${hit.join(', ')}, a repository of the team. ${instead}`;
}
/** Prints a program's output, line by line, dropping the line break it ends with. */
function printLines(text, print) {
    if (text === '') {
        return;
    }
    text.replace(/\r?\n$/u, '').split(/\r?\n/u).forEach(print);
}
/** Runs one gh call with its repository's or owner's saved key; a call teamrig will not run is refused before any key is read. */
export async function ghPass(args, ports) {
    const host = ports.env['GH_HOST'];
    if (host !== undefined && host !== '' && host.toLowerCase() !== 'github.com') {
        return refused(`GH_HOST names ${host}, and the saved keys are for github.com`);
    }
    const words = args.map((text) => ({ text, dynamic: false }));
    const folder = folderReposOf(ports);
    const picked = await targetFor(namedTargetsOf(words), folder);
    if (picked.kind === 'refused') {
        return picked;
    }
    const write = await writeRefusal(words, ports.github, folder);
    if (write !== undefined) {
        return refused(write);
    }
    const access = await accessOf(picked, ports.keys);
    if (access instanceof NoAccessError) {
        return refused(access.message);
    }
    try {
        const result = await ports.run({ program: GH_PROGRAM, args, env: access.env });
        printLines(result.stdout, (line) => ports.out.stdout(line));
        printLines(result.stderr, (line) => ports.out.stderr(line));
        const ok = result.end.kind === 'exited' && result.end.code === 0;
        if (!ok && KEY_FAILURE.test(result.stderr)) {
            ports.out.stderr(`teamrig gh: gh ran with ${access.credential}, the key saved for ${access.scope}; it may lack the right or be expired: save a new one with: ${access.save}`);
        }
        return { kind: 'ran', ok };
    }
    catch (error) {
        ports.out.stderr(`teamrig gh: gh did not run: ${errorMessage(error)}`);
        return { kind: 'ran', ok: false };
    }
}
