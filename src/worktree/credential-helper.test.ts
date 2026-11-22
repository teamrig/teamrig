import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HelperScope, HelperSkip } from '../core/git-credential.ts';
import { FakeWorktreeGit, type FakeGitAnswers } from '../testing/fake-worktrees.ts';
import { helperLine, wireCredentialHelper, type HelperRequest, type HelperScopeOf } from './credential-helper.ts';

const MAIN = '/src/app';
const ORIGIN = 'https://forge.test/acme/app.git';
const REQUEST: HelperRequest = { mainDir: MAIN, node: '/opt/node/bin/node', execArgv: ['--no-warnings'], script: '/opt/teamrig/main.js', platform: 'linux' };
const WORKTREES: FakeGitAnswers['worktrees'] = [
  { path: MAIN, branch: 'main', locked: undefined },
  { path: '/src/app-t4', branch: 't4', locked: undefined },
];
const SCOPE: HelperScope = { urlPrefix: 'https://forge.test', owner: 'acme' };

/** A scope reader that answers `answer` and records each URL it was asked about. */
function scopeReader(answer: HelperScope | HelperSkip): { scopeOf: HelperScopeOf; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    scopeOf: async (url) => {
      asked.push(url);
      return answer;
    },
  };
}

describe('helperLine', () => {
  it('runs the program, its options and the script by quoted absolute path, then git-credential', () => {
    assert.equal(helperLine(REQUEST), "!'/opt/node/bin/node' '--no-warnings' '/opt/teamrig/main.js' git-credential");
  });

  it('quotes a path holding a space or a quote as one word', () => {
    assert.equal(helperLine({ node: "/opt/my node/node", execArgv: [], script: "/opt/it's/main.js" }), "!'/opt/my node/node' '/opt/it'\\''s/main.js' git-credential");
  });
});

describe('wireCredentialHelper', () => {
  it('resets the helper list for the scope, adds teamrig, and has git send the path', async () => {
    const git = new FakeWorktreeGit({ origin: ORIGIN, worktrees: WORKTREES });
    const reader = scopeReader(SCOPE);
    const end = await wireCredentialHelper(REQUEST, { git, scopeOf: reader.scopeOf });
    assert.deepEqual(end, { kind: 'wired', line: 'git in /src/app now takes the key saved for acme for https://forge.test, through teamrig git-credential' });
    assert.deepEqual(reader.asked, [ORIGIN]);
    assert.deepEqual(git.steps, [
      `config --local credential.https://forge.test.helper = "", ${JSON.stringify(helperLine(REQUEST))} in /src/app`,
      'config --local credential.https://forge.test.useHttpPath = "true" in /src/app',
    ]);
  });

  it('takes the same steps when run again, so a second worktree add changes nothing', async () => {
    const git = new FakeWorktreeGit({ origin: ORIGIN, worktrees: WORKTREES });
    const ports = { git, scopeOf: scopeReader(SCOPE).scopeOf };
    await wireCredentialHelper(REQUEST, ports);
    const first = [...git.steps];
    await wireCredentialHelper(REQUEST, ports);
    assert.deepEqual(git.steps, [...first, ...first]);
  });

  it('skips a repository with no origin, asking for no scope', async () => {
    const git = new FakeWorktreeGit({ worktrees: WORKTREES });
    const reader = scopeReader(SCOPE);
    assert.deepEqual(await wireCredentialHelper(REQUEST, { git, scopeOf: reader.scopeOf }), { kind: 'skipped', why: '/src/app has no origin remote git could read' });
    assert.deepEqual(reader.asked, []);
    assert.deepEqual(git.steps, []);
  });

  it('skips an origin the scope serves none for, with its reason, changing nothing', async () => {
    const git = new FakeWorktreeGit({ origin: ORIGIN, worktrees: WORKTREES });
    const end = await wireCredentialHelper(REQUEST, { git, scopeOf: scopeReader({ skip: 'no key saved for acme' }).scopeOf });
    assert.deepEqual(end, { kind: 'skipped', why: 'no key saved for acme' });
    assert.deepEqual(git.steps, []);
  });

  for (const [what, request, why] of [
    ['a relative Node.js program', { ...REQUEST, node: 'node' }, 'node is no absolute path, so git would look for it where it runs'],
    ['a relative script', { ...REQUEST, script: 'dist/main.js' }, 'dist/main.js is no absolute path, so git would look for it where it runs'],
    ['a script inside a worktree', { ...REQUEST, script: '/src/app-t4/dist/main.js' }, '/src/app-t4/dist/main.js is inside the worktree /src/app-t4, where a branch could change it: run the installed teamrig'],
    ['a Node.js program inside the main checkout', { ...REQUEST, node: '/src/app/node_modules/.bin/node' }, '/src/app/node_modules/.bin/node is inside the worktree /src/app, where a branch could change it: run the installed teamrig'],
  ] as const) {
    it(`refuses ${what}, changing nothing`, async () => {
      const git = new FakeWorktreeGit({ origin: ORIGIN, worktrees: WORKTREES });
      assert.deepEqual(await wireCredentialHelper(request, { git, scopeOf: scopeReader(SCOPE).scopeOf }), { kind: 'refused', why });
      assert.deepEqual(git.steps, []);
    });
  }

  it('refuses when git cannot list the worktrees, since it cannot tell where teamrig runs from', async () => {
    const git = new FakeWorktreeGit({ origin: ORIGIN });
    const end = await wireCredentialHelper(REQUEST, { git, scopeOf: scopeReader(SCOPE).scopeOf });
    assert.deepEqual(end, { kind: 'refused', why: 'git could not list the worktrees of /src/app, so teamrig cannot tell whether it runs from inside one' });
    assert.deepEqual(git.steps, []);
  });

  it('fails at the first config write git refuses, saying how to undo the section', async () => {
    const git = new FakeWorktreeGit({ origin: ORIGIN, worktrees: WORKTREES, configFailsOn: 'credential.https://forge.test.useHttpPath' });
    const end = await wireCredentialHelper(REQUEST, { git, scopeOf: scopeReader(SCOPE).scopeOf });
    assert.deepEqual(end, {
      kind: 'failed',
      why: 'git config --local credential.https://forge.test.useHttpPath in /src/app: could not lock config file; undo it with git config --local --remove-section credential.https://forge.test there',
    });
    assert.equal(git.steps.length, 2);
  });
});
