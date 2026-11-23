import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TempRepo } from '../lib/temp-repo.ts';

const CLI = fileURLToPath(new URL('./pull-update-cli.ts', import.meta.url));

describe('pull update CLI', () => {
  let repo: TempRepo;
  let output: string;
  let summary: string;

  beforeEach(() => {
    repo = new TempRepo('pull-update').init();
    output = join(repo.outside, 'output');
    summary = join(repo.outside, 'summary');
    writeFileSync(output, '');
    writeFileSync(summary, '');
  });

  afterEach(() => repo.remove());

  const env = (over: Readonly<Record<string, string | undefined>> = {}) => ({
    GITHUB_EVENT_NAME: 'push',
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: summary,
    ...over,
  });

  it('takes no arguments', () => {
    const run = repo.run(CLI, ['now'], env());
    assert.equal(run.status, 2, run.stderr);
    assert.match(run.stderr, /pull-update: takes no arguments/);
  });

  it('exits 2 naming a missing value', () => {
    const run = repo.run(CLI, [], env({ GITHUB_EVENT_NAME: undefined }));
    assert.equal(run.status, 2, run.stderr);
    assert.match(run.stderr, /GITHUB_EVENT_NAME is not set/);
    assert.equal(readFileSync(output, 'utf8'), '');
  });

  it("reads the repo's channels and leaves the release pull request still on a push", () => {
    const run = repo.run(CLI, [], env());
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(output, 'utf8'), 'update=false\n');
  });

  it('updates it on a run by hand', () => {
    const run = repo.run(CLI, [], env({ GITHUB_EVENT_NAME: 'workflow_dispatch' }));
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(output, 'utf8'), 'update=true\n');
  });
});
