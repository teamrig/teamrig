import { GH_PROGRAM } from "../adapters/connectors/github/gh.js";
import { NoAccessError } from "../adapters/connectors/github/tokens.js";
import { errorMessage } from "../core/guards.js";
import { ghReachOf, repoHostRefusal, repoTarget } from "../hooks/gh-reach.js";
import { ghRouteOf } from "../hooks/gh-routes.js";
import { ghCallOf, remoteReposOf, repoValueOf } from "../hooks/gh-writes.js";
/** The errors gh prints when the key it used lacks a right or is no longer good. */
const KEY_FAILURE = /HTTP 40[13]\b|Bad credentials|Resource not accessible|requires authentication/iu;
function refused(why) {
    return { kind: 'refused', why };
}
function folderReposOf(ports) {
    let read;
    return () => {
        read ??= (async () => {
            const ghRepo = ports.env['GH_REPO'];
            if (ghRepo !== undefined && ghRepo !== '') {
                const value = repoValueOf(ghRepo);
                return value === undefined || repoHostRefusal(value.host, 'GH_REPO') !== undefined ? undefined : [value.repo];
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
    const picked = await targetFor(ghReachOf(words), folder);
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
