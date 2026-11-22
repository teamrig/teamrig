import assert from 'node:assert/strict';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TempRepo } from '../lib/temp-repo.ts';

const CLI = fileURLToPath(new URL('./promote-cli.ts', import.meta.url));

describe('promote CLI', () => {
  let repo: TempRepo;
  let origin: string;

  beforeEach(() => {
    repo = new TempRepo('promote-cli').init();
    origin = join(repo.outside, 'origin.git');
    repo.git('init', '-q', '--bare', origin);
    repo.git('remote', 'add', 'origin', origin);
    repo.write('plugin.txt', 'v1.0.0');
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', 'v1.0.0');
    repo.git('push', '-q', 'origin', 'HEAD:refs/heads/release');
  });

  afterEach(() => repo.remove());

  const head = (): string => repo.git('rev-parse', 'HEAD').trim();

  it('takes both hotfix values or neither', () => {
    for (const args of [['--hotfix-tag', 'v1.1.0'], ['--hotfix-sha', 'a'.repeat(40)], ['--hotfix-tag', 'v1.1.0', '--hotfix-sha', '']]) {
      const run = repo.run(CLI, args);
      assert.equal(run.status, 2, run.stderr);
      assert.match(run.stdout, /pass --hotfix-tag <v<version>> and --hotfix-sha <its commit> together, or neither/);
    }
  });

  it('refuses an option it does not know', () => {
    const run = repo.run(CLI, ['--force']);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /^promote: /);
  });

  it('does nothing, exit 0, on a remote with no preview branch', () => {
    const run = repo.run(CLI, ['--hotfix-tag', '', '--hotfix-sha', '']);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'promote: the remote has no preview branch yet; nothing to do\n');
  });

  it("says on a dry run which hotfix it would promote, and leaves the remote's release branch", () => {
    const stable = head();
    repo.write('plugin.txt', 'v1.1.0');
    repo.git('commit', '-q', '-am', 'v1.1.0');
    repo.git('tag', 'v1.1.0');
    repo.git('push', '-q', 'origin', 'HEAD:refs/heads/preview', 'refs/tags/v1.1.0');
    const run = repo.run(CLI, ['--hotfix-tag', 'v1.1.0', '--hotfix-sha', head(), '--dry-run']);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, `promote: would move release from ${stable} to v1.1.0 (${head()}); dry run, nothing pushed\n`);
    assert.equal(repo.git('ls-remote', origin, 'refs/heads/release').split('\t')[0], stable);
  });

  it('exits 2 naming why a hotfix is refused', () => {
    repo.git('push', '-q', 'origin', 'HEAD:refs/heads/preview');
    const run = repo.run(CLI, ['--hotfix-tag', 'v9.0.0', '--hotfix-sha', head()]);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /^promote: v9\.0\.0 is not a release on the preview branch$/m);
  });
});
