import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/release-slot.yml', import.meta.url), 'utf8');

/** Each job's text, from its `  <id>:` line to the next job's. */
const jobs: ReadonlyMap<string, string> = new Map(
  (workflow.split(/^jobs:\n/m)[1] ?? '')
    .split(/^(?= {2}[\w-]+:$)/m)
    .map((block) => [/^ {2}([\w-]+):$/m.exec(block)?.[1] ?? '', block]),
);
const slot = jobs.get('slot') ?? '';

const permissionsOf = (text: string): readonly string[] => [...(/^ {4}permissions:\n((?: {6}#.*\n)*(?: {6}.+\n)+)/m.exec(text)?.[1] ?? '').matchAll(/^ {6}([^#].*)$/gm)].map((match) => match[1] ?? '');

/** Each step's text, from its `      - ` line to the next step's. */
const steps: readonly string[] = (slot.split(/^ {4}steps:\n/m)[1] ?? '').split(/^(?= {6}- )/m).filter((step) => step.trim() !== '');

describe('release-slot.yml', () => {
  it('runs hourly and by hand, one at a time, never cancelled, with a read-only token by default', () => {
    assert.match(workflow, /^on:\n(?: {2}#.*\n)* {2}schedule:\n {4}- cron: '5 \* \* \* \*'\n {2}workflow_dispatch:\n/m);
    assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
    assert.match(workflow, /^concurrency:\n {2}group: release-slot\n {2}cancel-in-progress: false\n/m);
  });

  it('has the one job, skipped on a private copy, stopped within 10 minutes', () => {
    assert.deepEqual([...jobs.keys()].filter((id) => id !== ''), ['slot']);
    assert.match(slot, /^ {4}if: \$\{\{ !github\.event\.repository\.private \}\}$/m);
    assert.match(slot, /^ {4}timeout-minutes: 10$/m);
  });

  it('may start a ci run and read pull requests, nothing more, and holds no secret or environment', () => {
    assert.deepEqual(permissionsOf(slot), ['actions: write', 'contents: read', 'pull-requests: read']);
    assert.doesNotMatch(workflow, /environment:|secrets\./);
  });

  it('decides with release-slot-cli.ts, then runs ci.yml on the ref it wrote only when it said to', () => {
    const decide = steps.find((step) => step.includes('run: node tools/release/release-slot-cli.ts'));
    assert.ok(decide !== undefined);
    assert.match(decide, /^ {8}id: slot$|^ {6}- id: slot$/m);
    assert.match(decide, /^ {10}GITHUB_TOKEN: \$\{\{ github\.token \}\}$/m);
    const dispatch = steps.find((step) => step.includes('gh workflow run'));
    assert.ok(dispatch !== undefined);
    assert.match(dispatch, /^ {8}if: \$\{\{ steps\.slot\.outputs\.dispatch == 'true' \}\}$/m);
    assert.match(dispatch, /^ {8}run: gh workflow run ci\.yml --repo "\$GITHUB_REPOSITORY" --ref "\$REF"$/m);
    assert.match(dispatch, /^ {10}REF: \$\{\{ steps\.slot\.outputs\.ref \}\}$/m);
    assert.ok(steps.indexOf(decide) < steps.indexOf(dispatch));
  });

  it('puts no expression in a run line, caches nothing, installs no package and keeps no checkout credentials', () => {
    for (const [line] of workflow.matchAll(/^ *run: .*$/gm)) assert.doesNotMatch(line, /\$\{\{/, line);
    assert.doesNotMatch(workflow, /actions\/cache|download-artifact|cache:|npm (ci|install)/);
    assert.equal(workflow.match(/actions\/checkout@/g)?.length, workflow.match(/persist-credentials: false/g)?.length);
  });
});
