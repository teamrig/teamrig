import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TempRepo } from '../lib/temp-repo.ts';

const CLI = fileURLToPath(new URL('./app-token-cli.ts', import.meta.url));

describe('app token CLI', () => {
  let repo: TempRepo;
  let output: string;

  beforeEach(() => {
    repo = new TempRepo('app-token-cli').init();
    output = join(repo.outside, 'output');
    writeFileSync(output, '');
  });

  afterEach(() => repo.remove());

  it('takes mint or revoke and nothing else', () => {
    for (const args of [[], ['merge'], ['mint', 'extra']]) {
      const run = repo.run(CLI, args);
      assert.equal(run.status, 2, run.stderr);
      assert.match(run.stderr, /takes one argument: mint or revoke/);
    }
  });

  it('exits 2 on a malformed App id, never echoing the key', () => {
    const run = repo.run(CLI, ['mint'], { GITHUB_REPOSITORY: 'acme/tool', GITHUB_OUTPUT: output, APP_ID: 'x', APP_KEY: 'not a key' });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /APP_ID is not in the form/);
    assert.doesNotMatch(run.stderr + run.stdout, /not a key/);
    assert.equal(readFileSync(output, 'utf8'), '');
  });

  it('exits 2 when the key cannot sign, before any token is written', () => {
    const run = repo.run(CLI, ['mint'], { GITHUB_REPOSITORY: 'acme/tool', GITHUB_OUTPUT: output, APP_ID: '42', APP_KEY: 'not a key', GITHUB_API_URL: 'http://127.0.0.1:9' });
    assert.equal(run.status, 2);
    assert.doesNotMatch(run.stderr + run.stdout, /not a key/);
    assert.equal(readFileSync(output, 'utf8'), '');
  });

  it('only warns when the revoke cannot reach GitHub', () => {
    const run = repo.run(CLI, ['revoke'], { TOKEN: 'ghs_x', GITHUB_API_URL: 'http://127.0.0.1:9' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /::warning::the teamrig-release token could not be revoked/);
  });
});
