import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/release-promote.yml', import.meta.url), 'utf8');

/** Each job's text, from its `  <id>:` line to the next job's. */
const jobs: ReadonlyMap<string, string> = new Map(
  (workflow.split(/^jobs:\n/m)[1] ?? '')
    .split(/^(?= {2}[\w-]+:$)/m)
    .map((block) => [/^ {2}([\w-]+):$/m.exec(block)?.[1] ?? '', block]),
);
const promote = jobs.get('promote') ?? '';

const permissionsOf = (text: string): readonly string[] => [...(/^ {4}permissions:\n((?: {6}.+\n)+)/m.exec(text)?.[1] ?? '').matchAll(/^ {6}([^#].*)$/gm)].map((match) => match[1] ?? '');

describe('release-promote.yml', () => {
  it('runs hourly, and by hand with a hotfix tag and its sha, one at a time, never cancelled, with a read-only token by default', () => {
    assert.match(workflow, /^on:\n(?: {2}#.*\n)* {2}schedule:\n {4}- cron: '25 \* \* \* \*'\n {2}workflow_dispatch:\n {4}inputs:\n {6}tag:\n(?: {8}.+\n)+ {6}sha:\n/m);
    assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
    assert.match(workflow, /^concurrency:\n {2}group: release-promote\n {2}cancel-in-progress: false\n/m);
  });

  it('has the one job, skipped on a private copy or off main, stopped within 10 minutes', () => {
    assert.deepEqual([...jobs.keys()].filter((id) => id !== ''), ['promote']);
    assert.match(promote, /^ {4}if: \$\{\{ !github\.event\.repository\.private && github\.ref == 'refs\/heads\/main' \}\}$/m);
    assert.match(promote, /^ {4}timeout-minutes: 10$/m);
  });

  it('pushes with the release environment\'s deploy key alone, its token read-only', () => {
    assert.deepEqual(permissionsOf(promote), ['contents: read']);
    assert.match(promote, /^ {4}environment: release$/m);
    assert.match(promote, /^ {10}ssh-key: \$\{\{ secrets\.RELEASE_DEPLOY_KEY \}\}$/m);
    assert.equal(workflow.match(/secrets\./g)?.length, 1);
  });

  it('moves stable with promote-cli.ts alone, its inputs passed by env, never into the run line', () => {
    assert.match(promote, /^ {6}- run: node tools\/release\/promote-cli\.ts --hotfix-tag "\$TAG" --hotfix-sha "\$SHA"$/m);
    assert.match(promote, /^ {10}TAG: \$\{\{ inputs\.tag \}\}$/m);
    assert.match(promote, /^ {10}SHA: \$\{\{ inputs\.sha \}\}$/m);
    for (const [line] of workflow.matchAll(/^ *(?:- )?run: .*$/gm)) assert.doesNotMatch(line, /\$\{\{/, line);
    assert.doesNotMatch(workflow, /--force|actions\/cache|download-artifact|cache:|npm (ci|install)/);
  });
});
