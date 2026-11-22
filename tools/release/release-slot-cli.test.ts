import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TempRepo } from '../lib/temp-repo.ts';

const CLI = fileURLToPath(new URL('./release-slot-cli.ts', import.meta.url));

describe('release slot CLI', () => {
  let repo: TempRepo;
  let output: string;
  let summary: string;

  beforeEach(() => {
    repo = new TempRepo('release-slot').init();
    output = join(repo.outside, 'output');
    summary = join(repo.outside, 'summary');
    writeFileSync(output, '');
    writeFileSync(summary, '');
  });

  afterEach(() => repo.remove());

  const env = (over: Readonly<Record<string, string | undefined>> = {}) => ({
    GITHUB_REPOSITORY: 'teamrig/teamrig',
    GITHUB_TOKEN: 'read-token',
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: summary,
    // A closed port, so the first read fails at once without leaving the machine.
    GITHUB_API_URL: 'http://127.0.0.1:9',
    ...over,
  });

  it('takes no arguments', () => {
    const run = repo.run(CLI, ['now'], env());
    assert.equal(run.status, 2, run.stderr);
    assert.match(run.stderr, /release-slot: takes no arguments/);
  });

  it('exits 2 naming a missing value, writing no output', () => {
    const run = repo.run(CLI, [], env({ GITHUB_TOKEN: undefined }));
    assert.equal(run.status, 2, run.stderr);
    assert.match(run.stderr, /GITHUB_TOKEN is not set/);
    assert.equal(readFileSync(output, 'utf8'), '');
  });

  it('exits 2 when GitHub cannot be read, saying nothing to dispatch', () => {
    const run = repo.run(CLI, [], env());
    assert.equal(run.status, 2, run.stderr);
    assert.match(run.stderr, /^release-slot: /);
    assert.equal(readFileSync(output, 'utf8'), '');
  });
});
