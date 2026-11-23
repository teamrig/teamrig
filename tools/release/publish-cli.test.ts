import assert from 'node:assert/strict';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TempRepo } from '../lib/temp-repo.ts';

const CLI = fileURLToPath(new URL('./publish-cli.ts', import.meta.url));

describe('release publish CLI', () => {
  let repo: TempRepo;

  beforeEach(() => {
    repo = new TempRepo('release-cli').init();
  });

  afterEach(() => repo.remove());

  it('publishes the checked-out source with its dist to the release branch and its tag', () => {
    const origin = join(repo.outside, 'origin.git');
    repo.git('init', '-q', '--bare', origin);
    repo.git('remote', 'add', 'origin', origin);
    repo.write('plugins/teamrig/src.ts', 'one');
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', 'change one');
    repo.write('plugins/teamrig/dist/index.js', 'built one');
    const source = repo.git('rev-parse', 'HEAD').trim();
    const run = repo.run(CLI, ['--version', '0.448.0', '--source', source]);
    assert.equal(run.status, 0, run.stderr);
    const commit = repo.git('ls-remote', origin, 'refs/heads/release').split('\t')[0] ?? '';
    assert.equal(run.stdout, `release: published 0.448.0 as ${commit} on release, tagged v0.448.0\n`);
    assert.equal(repo.git('show', `${commit}:plugins/teamrig/dist/index.js`), 'built one');
  });

  it('publishes to the branch it names, started from its seed', () => {
    const origin = join(repo.outside, 'origin.git');
    repo.git('init', '-q', '--bare', origin);
    repo.git('remote', 'add', 'origin', origin);
    repo.write('plugins/teamrig/src.ts', 'one');
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', 'change one');
    const stable = repo.git('rev-parse', 'HEAD').trim();
    repo.git('push', '-q', origin, `${stable}:refs/heads/release`);
    repo.write('plugins/teamrig/src.ts', 'two');
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', 'change two');
    repo.write('plugins/teamrig/dist/index.js', 'built two');
    const source = repo.git('rev-parse', 'HEAD').trim();
    const run = repo.run(CLI, ['--version', '0.449.0', '--source', source, '--branch', 'preview', '--seed', 'release']);
    assert.equal(run.status, 0, run.stderr);
    const commit = repo.git('ls-remote', origin, 'refs/heads/preview').split('\t')[0] ?? '';
    assert.equal(repo.git('log', '-1', '--format=%P', commit).trim(), `${stable} ${source}`);
    assert.equal(repo.git('ls-remote', origin, 'refs/heads/release').split('\t')[0], stable);
  });

  it('exits 2 without a version or a source', () => {
    const run = repo.run(CLI, ['--version', '0.448.0']);
    assert.equal(run.status, 2);
    assert.equal(run.stdout, 'release: pass --version <MAJOR.MINOR.PATCH> and --source <main commit sha> [--branch <name> --seed <branch it starts from>]\n');
  });

  it('exits 2 with the reason when the publication is refused', () => {
    const run = repo.run(CLI, ['--version', 'v1', '--source', 'f'.repeat(40)]);
    assert.equal(run.status, 2);
    assert.equal(run.stderr, 'release: the version v1 is not MAJOR.MINOR.PATCH\n');
  });
});
