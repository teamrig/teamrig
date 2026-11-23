import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { GitError, type Git } from '../lib/git.ts';
import { AUTHOR, TempRepo } from '../lib/temp-repo.ts';
import { marketplaceFromCheckout, publicationProblem, publishRelease, type Files, type Publication } from './publish.ts';

const CATALOG = 'catalog/marketplace.json';

/** A catalog text of these plugin entries, written as main writes it. */
const catalogOf = (plugins: readonly unknown[]): string => `${JSON.stringify({ name: 'x', plugins }, null, 2)}\n`;

/** Main's catalog: one plugin installed from a folder of this repo at ref `release`, one already relative. */
const MAIN_CATALOG = catalogOf([
  { name: 'x', source: { source: 'git-subdir', url: 'https://example.com/x.git', path: 'plugins/x', ref: 'release' }, description: 'x' },
  { name: 'y', source: './plugins/y' },
]);

/** The catalog a release commit holds: both plugins from the marketplace's own checkout, naming no branch. */
const RELEASE_CATALOG = catalogOf([
  { name: 'x', source: './plugins/x', description: 'x' },
  { name: 'y', source: './plugins/y' },
]);

const DIST = 'plugins/x/dist';

/** git in the temp repo's own environment, so no global config of the machine running the tests reaches it. */
function gitIn(repo: TempRepo): Git {
  const run = (args: readonly string[]): Buffer => {
    const result = spawnSync('git', [...args], { cwd: repo.dir, env: repo.env });
    if (result.status !== 0) throw new GitError(args, result.stderr.toString('utf8'), result.status);
    return result.stdout;
  };
  return { text: async (args) => run(args).toString('utf8'), bytes: async (args) => run(args) };
}

describe('publishRelease', () => {
  let repo: TempRepo;
  let git: Git;
  let origin: string;
  const lines: string[] = [];

  /** Commits a change to main's source and returns its sha, with a fresh dist built beside it (untracked). */
  function release(content: string): string {
    repo.write('plugins/x/src.ts', content);
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', `change ${content}`);
    repo.write(`${DIST}/index.js`, `built ${content}`);
    return repo.git('rev-parse', 'HEAD').trim();
  }

  const at = (source: string, version: string): Publication => ({ version, source, branch: 'release', seed: undefined, dist: DIST, remote: 'origin', marketplace: undefined });
  const preview = (source: string, version: string): Publication => ({ ...at(source, version), branch: 'preview', seed: 'release' });
  const remote = (ref: string): string => repo.git('ls-remote', origin, ref).split('\t')[0] ?? '';
  const disk: Files = { read: (path) => readFileSync(join(repo.dir, path), 'utf8'), write: (path, text) => repo.write(path, text) };

  beforeEach(() => {
    repo = new TempRepo('release').init();
    origin = join(repo.outside, 'origin.git');
    repo.git('init', '-q', '--bare', origin);
    repo.git('remote', 'add', 'origin', origin);
    repo.write('.gitignore', 'plugins/x/dist/\n');
    git = gitIn(repo);
    lines.length = 0;
  });

  afterEach(() => repo.remove());

  it('makes the first release the source with its ignored dist on top, signed off, on the branch and its tag', async () => {
    const source = release('one');
    const commit = await publishRelease(git, disk, at(source, '1.0.0'), (line) => lines.push(line));
    assert.equal(remote('refs/heads/release'), commit);
    assert.equal(remote('refs/tags/v1.0.0'), commit);
    assert.equal(repo.git('log', '-1', '--format=%P', commit).trim(), source);
    assert.equal(repo.git('show', `${commit}:${DIST}/index.js`), 'built one');
    assert.equal(repo.git('show', `${commit}:plugins/x/src.ts`), 'one');
    assert.equal(
      repo.git('log', '-1', '--format=%B', commit).trim(),
      `release: teamrig 1.0.0\n\nThe plugin as main's ${source} holds it, with ${DIST} built by the release workflow.\n\nSigned-off-by: ${AUTHOR.name} <${AUTHOR.email}>`,
    );
    assert.deepEqual(lines, [`release: published 1.0.0 as ${commit} on release, tagged v1.0.0`]);
  });

  it('makes the next release a child of the last one and of its source, so the branch only moves forward', async () => {
    const first = await publishRelease(git, disk, at(release('one'), '1.0.0'), () => {});
    const source = release('two');
    const commit = await publishRelease(git, disk, at(source, '1.1.0'), () => {});
    assert.equal(repo.git('log', '-1', '--format=%P', commit).trim(), `${first} ${source}`);
    assert.equal(remote('refs/heads/release'), commit);
    assert.equal(remote('refs/tags/v1.0.0'), first);
    assert.equal(repo.git('show', `${commit}:${DIST}/index.js`), 'built two');
  });

  it("starts a branch not made yet from its seed's last commit, leaving the seed where it was", async () => {
    const stable = await publishRelease(git, disk, at(release('one'), '1.0.0'), () => {});
    const source = release('two');
    const commit = await publishRelease(git, disk, preview(source, '1.1.0'), (line) => lines.push(line));
    assert.equal(repo.git('log', '-1', '--format=%P', commit).trim(), `${stable} ${source}`);
    assert.equal(remote('refs/heads/preview'), commit);
    assert.equal(remote('refs/tags/v1.1.0'), commit);
    assert.equal(remote('refs/heads/release'), stable);
    assert.deepEqual(lines, [`release: preview starts from release's ${stable}`, `release: published 1.1.0 as ${commit} on preview, tagged v1.1.0`]);
  });

  it('builds on the branch itself once it exists, never on its seed again', async () => {
    await publishRelease(git, disk, at(release('one'), '1.0.0'), () => {});
    const first = await publishRelease(git, disk, preview(release('two'), '1.1.0'), () => {});
    const source = release('three');
    const commit = await publishRelease(git, disk, preview(source, '1.2.0'), () => {});
    assert.equal(repo.git('log', '-1', '--format=%P', commit).trim(), `${first} ${source}`);
  });

  it("makes the branch even when the seed's last commit holds the same build, as only the branch's own can", async () => {
    const source = release('one');
    const stable = await publishRelease(git, disk, at(source, '1.0.0'), () => {});
    repo.git('push', '-q', origin, ':refs/tags/v1.0.0');
    const commit = await publishRelease(git, disk, preview(source, '1.0.0'), () => {});
    assert.notEqual(commit, stable);
    assert.equal(repo.git('log', '-1', '--format=%P', commit).trim(), `${stable} ${source}`);
    assert.equal(remote('refs/heads/preview'), commit);
  });

  it('makes a first release on the source alone when the seed is not made either', async () => {
    const source = release('one');
    const commit = await publishRelease(git, disk, preview(source, '1.0.0'), () => {});
    assert.equal(repo.git('log', '-1', '--format=%P', commit).trim(), source);
    assert.equal(remote('refs/heads/release'), '');
  });

  it("commits the catalog installing from the marketplace's own checkout, leaving the source commit's catalog as it was", async () => {
    repo.write(CATALOG, MAIN_CATALOG);
    const source = release('one');
    const commit = await publishRelease(git, disk, { ...preview(source, '1.0.0'), marketplace: CATALOG }, () => {});
    assert.equal(repo.git('show', `${commit}:${CATALOG}`), RELEASE_CATALOG);
    assert.equal(repo.git('show', `${source}:${CATALOG}`), MAIN_CATALOG);
    assert.equal(repo.git('show', `${commit}:${DIST}/index.js`), 'built one');
  });

  it('installs a preview release fast-forwarded onto release from release, as its catalog names no branch', async () => {
    repo.write(CATALOG, MAIN_CATALOG);
    const commit = await publishRelease(git, disk, { ...preview(release('one'), '1.0.0'), marketplace: CATALOG }, () => {});
    repo.git('push', '-q', origin, `${commit}:refs/heads/release`);
    repo.git('fetch', '-q', origin, 'refs/heads/release');
    const promoted = repo.git('show', `FETCH_HEAD:${CATALOG}`);
    assert.equal(promoted, RELEASE_CATALOG);
    assert.doesNotMatch(promoted, /"ref"|preview/);
  });

  it('changes nothing when run again for a release whose catalog it rewrote', async () => {
    repo.write(CATALOG, MAIN_CATALOG);
    const source = release('one');
    const publication = { ...preview(source, '1.0.0'), marketplace: CATALOG };
    const commit = await publishRelease(git, disk, publication, () => {});
    assert.equal(await publishRelease(git, disk, publication, (line) => lines.push(line)), commit);
    assert.deepEqual(lines, [`release: preview and v1.0.0 already hold ${commit}, nothing to publish`]);
  });

  it('changes nothing when run again for a release already published', async () => {
    const source = release('one');
    const commit = await publishRelease(git, disk, at(source, '1.0.0'), () => {});
    assert.equal(await publishRelease(git, disk, at(source, '1.0.0'), (line) => lines.push(line)), commit);
    assert.deepEqual(lines, [`release: release and v1.0.0 already hold ${commit}, nothing to publish`]);
    assert.equal(remote('refs/heads/release'), commit);
  });

  it('tags a published release whose tag push was lost, without a new commit', async () => {
    const source = release('one');
    const commit = await publishRelease(git, disk, at(source, '1.0.0'), () => {});
    repo.git('push', '-q', origin, ':refs/tags/v1.0.0');
    assert.equal(await publishRelease(git, disk, at(source, '1.0.0'), (line) => lines.push(line)), commit);
    assert.equal(remote('refs/tags/v1.0.0'), commit);
    assert.deepEqual(lines, [`release: release already held ${commit}; tagged it v1.0.0`]);
  });

  it('never moves a tag that names another commit, and leaves the branch where it was', async () => {
    const first = await publishRelease(git, disk, at(release('one'), '1.0.0'), () => {});
    await assert.rejects(publishRelease(git, disk, at(release('two'), '1.0.0'), () => {}), new RegExp(`v1\\.0\\.0 already tags ${first}; a tag never moves`));
    assert.equal(remote('refs/heads/release'), first);
  });

  it('never moves a tag of the same build that names another commit', async () => {
    const source = release('one');
    const commit = await publishRelease(git, disk, at(source, '0.9.0'), () => {});
    repo.git('push', '-q', '--force', origin, `${source}:refs/tags/v0.9.0`);
    await assert.rejects(publishRelease(git, disk, at(source, '0.9.0'), () => {}), new RegExp(`v0\\.9\\.0 already tags ${source}, not the release ${commit}`));
  });

  it('refuses a checkout that is not at the source', async () => {
    const source = release('one');
    await assert.rejects(publishRelease(git, disk, at('a'.repeat(40), '1.0.0'), () => {}), new RegExp(`the checkout is at ${source}, not the release's source a{40}`));
    assert.equal(remote('refs/heads/release'), '');
  });

  it('refuses a source with no dist built', async () => {
    repo.write('plugins/x/src.ts', 'one');
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', 'change one');
    const source = repo.git('rev-parse', 'HEAD').trim();
    await assert.rejects(publishRelease(git, disk, at(source, '1.0.0'), () => {}), new RegExp(`no ${DIST} was built to publish`));
    assert.equal(remote('refs/heads/release'), '');
  });
});

describe('marketplaceFromCheckout', () => {
  it('makes each git-subdir entry a relative source of its folder, keeping a relative entry and the key order', () => {
    assert.equal(marketplaceFromCheckout(MAIN_CATALOG), RELEASE_CATALOG);
  });

  it('gives the same text back for a catalog already relative', () => {
    assert.equal(marketplaceFromCheckout(RELEASE_CATALOG), RELEASE_CATALOG);
  });

  it('keeps one ./ on a path that already starts with it', () => {
    const text = catalogOf([{ name: 'x', source: { source: 'git-subdir', url: 'https://example.com/x.git', path: './plugins/x' } }]);
    assert.equal(marketplaceFromCheckout(text), catalogOf([{ name: 'x', source: './plugins/x' }]));
  });

  it('refuses an entry whose path is no folder of this repository', () => {
    for (const path of ['', '/srv/work/x', '../other/x', 'plugins/../../x']) {
      const text = catalogOf([{ name: 'x', source: { source: 'git-subdir', url: 'https://example.com/x.git', path } }]);
      assert.throws(() => marketplaceFromCheckout(text), /the catalog entry x names no folder of this repository as its path/, path);
    }
  });

  it('refuses a catalog with no plugins list', () => {
    assert.throws(() => marketplaceFromCheckout('{"name":"x"}'), /the marketplace catalog has no "plugins" list/);
  });
});

describe('publicationProblem', () => {
  const good: Publication = { version: '0.448.0', source: 'f'.repeat(40), branch: 'release', seed: undefined, dist: 'dist', remote: 'origin', marketplace: undefined };

  it('takes a MAJOR.MINOR.PATCH version and a full sha', () => {
    assert.equal(publicationProblem(good), undefined);
  });

  it('refuses a version with a prefix or a pre-release, and a short or named source', () => {
    assert.equal(publicationProblem({ ...good, version: 'v0.448.0' }), 'the version v0.448.0 is not MAJOR.MINOR.PATCH');
    assert.equal(publicationProblem({ ...good, version: '0.448.0-rc.1' }), 'the version 0.448.0-rc.1 is not MAJOR.MINOR.PATCH');
    assert.equal(publicationProblem({ ...good, source: 'main' }), 'the source main is not a full commit sha');
    assert.equal(publicationProblem({ ...good, source: 'f'.repeat(39) }), `the source ${'f'.repeat(39)} is not a full commit sha`);
  });
});
