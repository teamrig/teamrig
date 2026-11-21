import { GH_PROGRAM } from '../adapters/connectors/github/gh.ts';
import { NoAccessError, type RepoAccess } from '../adapters/connectors/github/tokens.ts';
import { errorMessage } from '../core/guards.ts';
import type { Env } from '../core/home.ts';
import type { ProgramRunner } from '../core/program-runner.ts';
import { ghRouteOf } from '../hooks/gh-routes.ts';
import type { GithubRepos } from '../hooks/gh-write-refusals.ts';
import { apiEndpointOf, apiRepoOf, endpointPath, ghCallOf, ghCommandSlotOf, ghGroupKind, remoteReposOf, repoFlagsOf, repoFlagValue } from '../hooks/gh-writes.ts';
import type { ShellWord } from '../push-guard/tokenizer.ts';
import type { Output } from './runtime.ts';

/**
 * `teamrig gh -- <gh args>` (T4897 S1): runs gh with the key saved for the owner of the repository it reaches, never
 * the machine's own gh login, which may be another project's key. The owner comes from the call's words (`-R`, a
 * `gh api` path, a `gh repo` command's repository), else `GH_REPO`, else the folder's git remotes; a run that reaches
 * more than one owner, or none teamrig can tell, is refused, as is a group that changes gh itself (auth, config,
 * alias, extension) or runs code that is not gh's (an alias or an extension would hold the key). A write on one of the
 * team's repositories (`github.repos`) stays with teamrig's own commands, which check who may write.
 */

/** The saved key of one GitHub owner. */
export interface OwnerKeys {
  accessForOwner(owner: string): Promise<RepoAccess | NoAccessError>;
}

/** What a run reads besides gh's words. */
export interface GhPassPorts {
  /** Runs gh, and git to read the folder's remotes. */
  readonly run: ProgramRunner;
  readonly keys: OwnerKeys;
  /** The caller's environment, for `GH_REPO` and `GH_HOST`. */
  readonly env: Env;
  /** The folder gh runs in. */
  readonly cwd: string;
  readonly github: GithubRepos;
  readonly out: Output;
}

/** How a run ended: refused before gh ran, or gh's own end. */
export type GhPassOutcome = { readonly kind: 'refused'; readonly why: string } | { readonly kind: 'ran'; readonly ok: boolean };

/** The owners a call's words name, that gh picks one from the folder, or why teamrig will not run it. */
type Named = { readonly kind: 'owners'; readonly owners: readonly string[] } | { readonly kind: 'folder' } | { readonly kind: 'refused'; readonly why: string };

const FOLDER: Named = { kind: 'folder' };

/** A GitHub owner's name: letters, digits and dashes. */
const OWNER_NAME = /^[a-z\d][a-z\d-]{0,38}$/iu;

/** The `gh api` paths whose second part is an owner: `orgs/<owner>/...`, `users/<owner>/...`. */
const OWNER_PATHS: ReadonlySet<string> = new Set(['orgs', 'users']);

/** The hosts a full `gh api` URL may reach: a key saved for github.com goes nowhere else. */
const GITHUB_HOSTS: ReadonlySet<string> = new Set(['github.com', 'api.github.com']);

/** The `gh repo` commands that take the repository as a word of their own (`gh repo view acme/web`). */
const REPO_POSITIONAL: ReadonlySet<string> = new Set(['view', 'clone', 'edit', 'delete', 'fork', 'archive', 'unarchive', 'sync']);

/** The errors gh prints when the key it used lacks a right or is no longer good. */
const KEY_FAILURE = /HTTP 40[13]\b|Bad credentials|Resource not accessible|requires authentication/iu;

function refused(why: string): { readonly kind: 'refused'; readonly why: string } {
  return { kind: 'refused', why };
}

function ownerOfRepo(repo: string): string {
  return repo.slice(0, repo.indexOf('/')).toLowerCase();
}

/** The host a full URL reaches, lowercase; undefined for a path. */
function urlHostOf(text: string): string | undefined {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:?#]*)/iu.exec(text);
  return match === null ? undefined : (match[1] ?? '').toLowerCase();
}

/** The owner a `gh api` call reaches: by its path, else the folder's. */
function apiNamed(rest: readonly ShellWord[]): Named {
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
  const repo = apiRepoOf(path);
  if (repo === 'folder') {
    return FOLDER;
  }
  if (repo !== undefined) {
    return { kind: 'owners', owners: [ownerOfRepo(repo)] };
  }
  const [first, owner] = path.split('/');
  return first !== undefined && OWNER_PATHS.has(first) && owner !== undefined && OWNER_NAME.test(owner) ? { kind: 'owners', owners: [owner.toLowerCase()] } : FOLDER;
}

/** The owner a group's call reaches: its `-R` values, a `gh repo` command's repository word, else the folder's. */
function groupNamed(group: string, rest: readonly ShellWord[]): Named {
  const flags = repoFlagsOf(rest);
  if (flags === undefined) {
    return refused('its `-R` value names no repository');
  }
  if (flags.given) {
    return { kind: 'owners', owners: flags.repos.map(ownerOfRepo) };
  }
  if (group !== 'repo') {
    return FOLDER;
  }
  const slot = ghCommandSlotOf(rest);
  if (slot.kind !== 'command' || slot.command === undefined || !REPO_POSITIONAL.has(slot.command.text)) {
    return FOLDER;
  }
  const repo = slot.rest.flatMap((word) => {
    const named = word.text.startsWith('-') ? undefined : repoFlagValue(word.text);
    return named === undefined ? [] : [named];
  })[0];
  return repo === undefined ? FOLDER : { kind: 'owners', owners: [ownerOfRepo(repo)] };
}

/** The owners a call's words name, or that the folder picks; a group teamrig will not run with a key is refused. */
export function namedOwnersOf(words: readonly ShellWord[]): Named {
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

/** The repositories gh picks one from when the words name none: `GH_REPO`, else the folder's remotes; undefined when teamrig cannot tell. */
type FolderRepos = () => Promise<readonly string[] | undefined>;

function folderReposOf(ports: GhPassPorts): FolderRepos {
  let read: Promise<readonly string[] | undefined> | undefined;
  return () => {
    read ??= (async () => {
      const ghRepo = ports.env['GH_REPO'];
      if (ghRepo !== undefined && ghRepo !== '') {
        const repo = repoFlagValue(ghRepo);
        return repo === undefined ? undefined : [repo];
      }
      const listing = await ports.run({ program: 'git', args: ['-C', ports.cwd, 'remote', '-v'] }).catch(() => undefined);
      return listing === undefined || listing.end.kind !== 'exited' || listing.end.code !== 0 ? [] : remoteReposOf(listing.stdout);
    })();
    return read;
  };
}

/** The one owner whose key the run uses, or why there is none. */
async function ownerFor(named: Named, folder: FolderRepos): Promise<{ readonly kind: 'owner'; readonly owner: string } | { readonly kind: 'refused'; readonly why: string }> {
  if (named.kind === 'refused') {
    return named;
  }
  let owners = named.kind === 'owners' ? named.owners : [];
  if (named.kind === 'folder') {
    const repos = await folder();
    if (repos === undefined) {
      return refused('it reaches the repository of the folder (or `GH_REPO`), which teamrig cannot read: a remote reaches GitHub in a form it cannot read (an SSH alias, a port), or `GH_REPO` names none; name the repository with `-R <owner>/<name>`');
    }
    if (repos.length === 0) {
      return refused('it names no repository and the folder has no GitHub remote, so no owner to pick a key for; name the repository with `-R <owner>/<name>`');
    }
    owners = repos.map(ownerOfRepo);
  }
  const unique = [...new Set(owners)];
  const [owner] = unique;
  if (owner === undefined) {
    return refused('it names no repository owner');
  }
  return unique.length > 1 ? refused(`it reaches ${unique.join(', ')}: one run uses one owner's key; name one repository with \`-R <owner>/<name>\``) : { kind: 'owner', owner };
}

/** Why a write is left to teamrig's own commands: it may land on one of the team's repositories. */
async function writeRefusal(words: readonly ShellWord[], github: GithubRepos, folder: FolderRepos): Promise<string | undefined> {
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
function printLines(text: string, print: (line: string) => void): void {
  if (text === '') {
    return;
  }
  text.replace(/\r?\n$/u, '').split(/\r?\n/u).forEach(print);
}

/** Runs one gh call with its owner's saved key; a call teamrig will not run is refused before any key is read. */
export async function ghPass(args: readonly string[], ports: GhPassPorts): Promise<GhPassOutcome> {
  const host = ports.env['GH_HOST'];
  if (host !== undefined && host !== '' && host.toLowerCase() !== 'github.com') {
    return refused(`GH_HOST names ${host}, and the saved keys are for github.com`);
  }
  const words: readonly ShellWord[] = args.map((text) => ({ text, dynamic: false }));
  const folder = folderReposOf(ports);
  const picked = await ownerFor(namedOwnersOf(words), folder);
  if (picked.kind === 'refused') {
    return picked;
  }
  const write = await writeRefusal(words, ports.github, folder);
  if (write !== undefined) {
    return refused(write);
  }
  const access = await ports.keys.accessForOwner(picked.owner);
  if (access instanceof NoAccessError) {
    return refused(access.message);
  }
  try {
    const result = await ports.run({ program: GH_PROGRAM, args, env: access.env });
    printLines(result.stdout, (line) => ports.out.stdout(line));
    printLines(result.stderr, (line) => ports.out.stderr(line));
    const ok = result.end.kind === 'exited' && result.end.code === 0;
    if (!ok && KEY_FAILURE.test(result.stderr)) {
      ports.out.stderr(`teamrig gh: gh ran with ${access.credential}, the key saved for ${access.owner}; it may lack the right or be expired: save a new one with: ${access.save}`);
    }
    return { kind: 'ran', ok };
  } catch (error) {
    ports.out.stderr(`teamrig gh: gh did not run: ${errorMessage(error)}`);
    return { kind: 'ran', ok: false };
  }
}
