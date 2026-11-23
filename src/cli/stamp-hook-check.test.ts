import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { CliHarness, TEAM } from '../testing/cli-harness.ts';
import { FakeSecretsGit } from '../testing/fake-secrets-git.ts';
import { EXIT } from './runtime.ts';
import { STAMP_HOOKS } from './stamp-hook-check.ts';

const API = resolve('/', 'r', 'api');
const WEB = resolve('/', 'r', 'web');
const REPOS = { ...TEAM, delivery: { repos: { api: { mainCheckout: API }, web: { mainCheckout: WEB } } } };
const SOURCE = 'from the stamp hook check [delivery.repos, commits.stamp]: STAMP-HOOK';
const ADD = '`teamrig stamp commit "$1" || true` to commit-msg';

/** A git that finds each repository's hooks in the folder given. */
function gitWithHooks(dirs: Readonly<Record<string, string>>): FakeSecretsGit {
  const git = new FakeSecretsGit(undefined);
  Object.entries(dirs).forEach(([main, hooks]) => git.hookDirs.set(main, hooks));
  return git;
}

/** The lead's check rows from the stamp hook check. */
async function stampRows(kit: CliHarness, secretsGit: FakeSecretsGit): Promise<string[]> {
  const result = await kit.run(['check', '--all'], { env: { TEAMRIG_SESSION: 'lead' }, secretsGit });
  assert.equal(result.code, EXIT.ok, result.stderr.join('\n'));
  return result.stdout.filter((line) => line.includes('the stamp hook check'));
}

describe('check STAMP-HOOK (T4869)', () => {
  it('flags a repository whose commit-msg skips the stamp, with the line to add, and passes one that runs it', async () => {
    const kit = new CliHarness(REPOS);
    const apiHooks = join(API, '.git', 'hooks');
    const webHooks = join(WEB, '.githooks');
    await kit.files.write(join(apiHooks, 'commit-msg'), '#!/bin/sh\n# teamrig stamp commit is not run here\nteamrig secrets message "$1" || exit 1\n');
    await kit.files.write(join(webHooks, 'commit-msg'), '#!/bin/sh\nnode src/cli/main.ts stamp commit "$1" || true\n');
    assert.deepEqual(await stampRows(kit, gitWithHooks({ [API]: apiHooks, [WEB]: webHooks })), [
      `${SOURCE} api (${apiHooks}) runs no commit stamp in commit-msg, so its commits do not name the program, model and effort that made them: add ${ADD}`,
    ]);
  });

  it('passes over a repository git cannot read, which SECRET-HOOK already names', async () => {
    const kit = new CliHarness(REPOS);
    const webHooks = join(WEB, '.git', 'hooks');
    await kit.files.write(join(webHooks, 'commit-msg'), '#!/bin/sh\nteamrig stamp commit "$1" || true\n');
    assert.deepEqual(await stampRows(kit, gitWithHooks({ [WEB]: webHooks })), []);
  });

  it('flags nothing while the team sets commits.stamp false', async () => {
    const kit = new CliHarness({ ...REPOS, commits: { stamp: false } });
    assert.deepEqual(await stampRows(kit, gitWithHooks({ [API]: join(API, '.git', 'hooks'), [WEB]: join(WEB, '.git', 'hooks') })), []);
  });
});

describe('STAMP_HOOKS', () => {
  it('is the commit-msg hook calling stamp commit, never blocking the commit', () => {
    assert.deepEqual(STAMP_HOOKS.map((hook) => [hook.hook, hook.command, hook.sub, hook.line.endsWith('|| true')]), [['commit-msg', 'stamp', 'commit', true]]);
  });
});
