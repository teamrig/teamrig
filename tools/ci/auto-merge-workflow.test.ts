import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/auto-merge.yml', import.meta.url), 'utf8');

/** The workflow's lines with their comments taken out, so a comment can never pass or fail a check. */
const code = workflow
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

/** The job's text, from its `  auto-merge:` line to the end. */
const job = /^ {2}auto-merge:\n[\s\S]*$/m.exec(code)?.[0] ?? '';

const permissionsOf = (text: string, indent: number): readonly string[] => {
  const pad = ' '.repeat(indent);
  const block = new RegExp(`^${pad}permissions:\\n((?:${pad} {2}.+\\n)+)`, 'm').exec(text)?.[1] ?? '';
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
};

describe('auto-merge.yml', () => {
  it("runs on every pull request into main that opens, reopens, leaves draft or takes a push, from main's copy", () => {
    assert.match(code, /^on:\n {2}pull_request_target:\n {4}types: \[opened, reopened, ready_for_review, synchronize\]\n {4}branches: \[main\]\n/m);
    assert.doesNotMatch(code, /^ {2}(pull_request|push|workflow_run|workflow_dispatch|issue_comment):/m);
  });

  it('has the job', () => {
    assert.notEqual(job, '');
  });

  it('skips drafts, which GitHub refuses auto-merge on, and a private copy of the repository', () => {
    assert.match(job, /^ {4}if: \$\{\{ !github\.event\.repository\.private && !github\.event\.pull_request\.draft \}\}$/m);
  });

  it('checks out no code and runs no package, so nothing the pull request wrote ever runs', () => {
    assert.doesNotMatch(code, /actions\/checkout|uses:|npm |npx |node /);
    assert.equal(code.match(/^ {6}- run: /gm)?.length, 1);
  });

  it('uses no secret, only the job token, which is on no bypass list, so review and checks still hold', () => {
    assert.doesNotMatch(code, /secrets\.|environment:/);
    assert.match(job, /^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
  });

  it('reads contents by default and writes only what switching auto-merge on needs, in its job', () => {
    assert.deepEqual(permissionsOf(code, 0), ['contents: read']);
    assert.deepEqual(permissionsOf(job, 4), ['contents: write', 'pull-requests: write']);
  });

  it('switches rebase auto-merge on by the pull request number from env, with no event value in the run line', () => {
    assert.match(job, /^ {6}- run: gh pr merge --auto --rebase "\$PR" --repo "\$GITHUB_REPOSITORY"$/m);
    assert.match(job, /^ {10}PR: \$\{\{ github\.event\.pull_request\.number \}\}$/m);
    for (const [line] of code.matchAll(/^ *- run: .*$/gm)) assert.doesNotMatch(line, /\$\{\{/, line);
  });

  it('replaces a waiting run on a newer push and stops within 5 minutes', () => {
    assert.match(code, /^concurrency:\n {2}group: auto-merge-\$\{\{ github\.event\.pull_request\.number \}\}\n {2}cancel-in-progress: true\n/m);
    assert.match(job, /^ {4}timeout-minutes: 5$/m);
  });
});
