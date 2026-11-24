import type { Git } from '../lib/git.ts';
import { isRecord, recordField } from '../lib/guards.ts';

/**
 * Publishes a release's build (T3346). The marketplace entry installs the plugin from the `release` branch, so a
 * release's commit on main is made again there with the compiled dist on top: the next commit of that branch, tagged
 * `v<version>` so an install can pin it. Its parents are the branch's last release and the main commit it was built
 * from, so the branch only moves forward and each build names its source. A tag never moves, and a run again for a
 * release already published changes nothing, so a re-run workflow is safe. The release workflow publishes to
 * `preview` (T5133), whose first commit descends from `release`, and stable moves `release` along that chain. Each
 * release commit's marketplace catalog installs the plugin from the marketplace's own checkout, a relative source with
 * no ref (T5224): a marketplace following `preview` installs preview builds, and the same commit fast-forwarded onto
 * `release` installs from `release`, so the channel is only the branch the marketplace follows. Stable installs
 * follow the default branch, whose catalog keeps naming `release`.
 */

export interface Publication {
  /** The released version, MAJOR.MINOR.PATCH. */
  readonly version: string;
  /** The full sha of main's commit the release was cut at, which is checked out with the dist built in it. */
  readonly source: string;
  /** The branch the marketplace entry installs from. */
  readonly branch: string;
  /**
   * The branch a first publication starts from when `branch` is not made yet, or undefined for none. `preview` starts
   * from `release` (T5133), so stable can later fast-forward `release` to any preview build.
   */
  readonly seed: string | undefined;
  /** The folder the build writes, added to the commit even when the repo ignores it. */
  readonly dist: string;
  /** The remote both the branch and the tag are pushed to. */
  readonly remote: string;
  /**
   * The marketplace catalog, its entries made relative sources in the commit, or undefined to leave it. Main's names
   * ref `release`, so without this a marketplace added at `preview` would install the stable build (T5224).
   */
  readonly marketplace: string | undefined;
}

/** The checkout's files, read and written by paths relative to its root. */
export interface Files {
  read(path: string): string;
  write(path: string, text: string): void;
}

/**
 * The catalog with each plugin entry installed from a folder of this repository (a `git-subdir` source) installing
 * from that folder of the marketplace's own checkout instead: a relative source, which names no branch, so the build a
 * commit holds installs itself on whichever branch the commit sits (T5224). The catalog lists only this repository's
 * plugins. Entries already relative stay as they are.
 */
export function marketplaceFromCheckout(text: string): string {
  const catalog: unknown = JSON.parse(text);
  if (!isRecord(catalog) || !Array.isArray(catalog['plugins'])) throw new Error('the marketplace catalog has no "plugins" list');
  const entries: readonly unknown[] = catalog['plugins'];
  const plugins = entries.map((entry) => {
    const source = isRecord(entry) ? recordField(entry, 'source') : undefined;
    if (!isRecord(entry) || source === undefined || source['source'] !== 'git-subdir') return entry;
    const path = source['path'];
    if (typeof path !== 'string' || path === '' || path.startsWith('/') || path.split('/').includes('..')) {
      throw new Error(`the catalog entry ${String(entry['name'])} names no folder of this repository as its path`);
    }
    return { ...entry, source: `./${path.replace(/^\.\//, '')}` };
  });
  return `${JSON.stringify({ ...catalog, plugins }, null, 2)}\n`;
}

const VERSION = /^\d+\.\d+\.\d+$/;
const SHA = /^[0-9a-f]{40}$/;

const tagOf = (version: string): string => `refs/tags/v${version}`;

/** The sha a ref has on the remote, or undefined when the remote has no such ref. */
async function remoteSha(git: Git, remote: string, ref: string): Promise<string | undefined> {
  const line = (await git.text(['ls-remote', remote, ref])).split('\n').find((row) => row.endsWith(`\t${ref}`));
  return line?.split('\t')[0];
}

/** The last commit of the first of the branches the remote has, fetched here, with that branch's name. */
async function lastOf(git: Git, remote: string, branches: readonly string[]): Promise<{ readonly sha: string; readonly branch: string } | undefined> {
  for (const branch of branches) {
    const sha = await remoteSha(git, remote, `refs/heads/${branch}`);
    if (sha === undefined) continue;
    await git.text(['fetch', '--quiet', '--no-tags', remote, `refs/heads/${branch}`]);
    return { sha, branch };
  }
  return undefined;
}

/** The `Name <email>` of the commits git makes here, for the Signed-off-by line. */
async function signer(git: Git): Promise<string> {
  const ident = /^(.+?) <([^<>]+)>/.exec((await git.text(['var', 'GIT_AUTHOR_IDENT'])).trim());
  if (ident === null) throw new Error('cannot read a name and e-mail from the git author ident');
  return `${ident[1]} <${ident[2]}>`;
}

/** Why the publication cannot run, or undefined when its fields are well formed. */
export function publicationProblem(publication: Publication): string | undefined {
  if (!VERSION.test(publication.version)) return `the version ${publication.version} is not MAJOR.MINOR.PATCH`;
  if (!SHA.test(publication.source)) return `the source ${publication.source} is not a full commit sha`;
  return undefined;
}

/**
 * Commits the checked-out source with its built dist onto the release branch and tags it, or finds it done already.
 * Returns the release commit's sha. Refuses a checkout not at the source, a missing dist, and a tag that names
 * another commit.
 */
export async function publishRelease(git: Git, files: Files, publication: Publication, log: (line: string) => void): Promise<string> {
  const problem = publicationProblem(publication);
  if (problem !== undefined) throw new Error(problem);
  const { version, source, branch, seed, dist, remote, marketplace } = publication;
  const head = (await git.text(['rev-parse', 'HEAD'])).trim();
  if (head !== source) throw new Error(`the checkout is at ${head}, not the release's source ${source}`);

  // --others lists ignored files too, as the dist is once main stops tracking it.
  if ((await git.text(['ls-files', '--cached', '--others', '--', dist])).trim() === '') throw new Error(`no ${dist} was built to publish`);
  await git.text(['add', '--force', '--', dist]);
  if (marketplace !== undefined) {
    files.write(marketplace, marketplaceFromCheckout(files.read(marketplace)));
    await git.text(['add', '--', marketplace]);
  }
  const tree = (await git.text(['write-tree'])).trim();

  const tag = tagOf(version);
  const [found, tagged] = [await lastOf(git, remote, seed === undefined ? [branch] : [branch, seed]), await remoteSha(git, remote, tag)];
  // Only the branch's own last commit can already hold this build; a seed's never does, as the branch is not made yet.
  if (found !== undefined && found.branch === branch) {
    const last = found.sha;
    const [lastTree, lastParents] = (await git.text(['log', '-1', '--format=%T%n%P', last])).trim().split('\n');
    if (lastTree === tree && (lastParents ?? '').split(' ').includes(source)) {
      if (tagged === last) {
        log(`release: ${branch} and v${version} already hold ${last}, nothing to publish`);
        return last;
      }
      if (tagged !== undefined) throw new Error(`v${version} already tags ${tagged}, not the release ${last}; a tag never moves`);
      await git.text(['push', remote, `${last}:${tag}`]);
      log(`release: ${branch} already held ${last}; tagged it v${version}`);
      return last;
    }
  }
  if (tagged !== undefined) throw new Error(`v${version} already tags ${tagged}; a tag never moves`);

  const message = [
    `release: teamrig ${version}`,
    `The plugin as main's ${source} holds it, with ${dist} built by the release workflow.`,
    `Signed-off-by: ${await signer(git)}`,
  ].join('\n\n');
  const parents = found === undefined ? ['-p', source] : ['-p', found.sha, '-p', source];
  const commit = (await git.text(['commit-tree', tree, ...parents, '-m', message])).trim();
  await git.text(['push', '--atomic', remote, `${commit}:refs/heads/${branch}`, `${commit}:${tag}`]);
  if (found !== undefined && found.branch !== branch) log(`release: ${branch} starts from ${found.branch}'s ${found.sha}`);
  log(`release: published ${version} as ${commit} on ${branch}, tagged v${version}`);
  return commit;
}
