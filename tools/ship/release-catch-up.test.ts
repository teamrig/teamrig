import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { TempRepo } from '../lib/temp-repo.ts';
import { catchUpRelease, releaseMoveRefusal } from './release-catch-up.ts';

const RELEASE = 'release-please--branches--main';

describe('release catch-up (T5055)', () => {
  let repo: TempRepo;
  let logged: string[];
  const git = (...args: string[]): string => repo.git(...args).trim();
  const commit = (path: string, content: string, message: string): string => {
    repo.write(path, content);
    git('add', '--all');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const onOrigin = (branch: string): string => git('ls-remote', 'origin', `refs/heads/${branch}`).split('\t')[0] ?? '';
  /** main moved past the release head by `moves` ([path, content, message]), pushed; returns the release head and main's tip. */
  const moveMain = (...moves: readonly (readonly [string, string, string])[]): { sha: string; tip: string } => {
    git('switch', '-q', 'main');
    for (const [path, content, message] of moves) commit(path, content, message);
    git('push', '-q', 'origin', 'main');
    return { sha: onOrigin(RELEASE), tip: git('rev-parse', 'HEAD') };
  };
  const catchUp = (sha: string, tip: string) => catchUpRelease({ git, log: (line) => logged.push(line) }, { head: RELEASE, sha, tip, main: 'main' });

  const originOf = (of: TempRepo): string => join(of.outside, 'origin.git');

  // main, its bare origin and the release head pushed there, made once with git and copied per test (T5274): their
  // twelve git runs took most of each test's time on a loaded Windows host.
  let template: TempRepo;

  before(() => {
    repo = new TempRepo('release-catch-up-template').init();
    git('checkout', '-q', '-b', 'main');
    commit('release-please-config.json', '{ "packages": { ".": {} } }\n', 'chore: start');
    commit('src/a.ts', 'export const a = 1;\n', 'feat: a');
    git('init', '-q', '--bare', originOf(repo));
    git('remote', 'add', 'origin', originOf(repo));
    git('push', '-q', 'origin', 'main');
    git('switch', '-q', '-c', RELEASE);
    commit('CHANGELOG.md', '# Changelog\n\n## 1.1.0\n\n- a\n', 'chore(main): release 1.1.0');
    git('push', '-q', 'origin', RELEASE);
    git('switch', '-q', 'main');
    git('branch', '-q', '-D', RELEASE);
    template = repo;
  });

  beforeEach(() => {
    repo = new TempRepo('release-catch-up').copyFrom(template);
    // The copy's remote still names the template's origin; each test talks only to its own.
    git('remote', 'set-url', 'origin', originOf(repo));
    logged = [];
  });

  afterEach(() => repo.remove());

  after(() => template.remove());

  it('rebases a head main moved past only by hidden types onto main, pushes it to the same branch and goes back', () => {
    const { sha, tip } = moveMain(['.github/ci.yml', 'on: push\n', 'ci: cache downloads'], ['src/a.ts', 'export const a = 1; // same\n', 'refactor(core): a reads plainer']);

    const caught = catchUp(sha, tip);

    assert.equal(caught.kind, 'rebased');
    assert.ok(caught.kind === 'rebased');
    assert.equal(caught.head, RELEASE);
    assert.equal(onOrigin(RELEASE), caught.sha, 'pushed to the same branch, so the same pull request');
    assert.equal(git('rev-parse', `${caught.sha}^`), tip, 'it sits right on main');
    assert.equal(git('diff', tip, caught.sha), git('diff', `${sha}^`, sha), 'the same diff as the approved head');
    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'the repo dir is back on its branch');
    assert.match(logged.join('\n'), /only by commits its changelog hides/);
  });

  it('goes back to a detached checkout as it was', () => {
    const { sha, tip } = moveMain(['.github/ci.yml', 'on: push\n', 'ci: cache downloads']);
    git('switch', '-q', '--detach', `${tip}^`);

    assert.equal(catchUp(sha, tip).kind, 'rebased');
    assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', `${tip}^`));
    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD');
  });

  const shown: readonly (readonly [string, string, RegExp])[] = [
    ['a feat', 'feat: b', /its type feat shows in the changelog/],
    ['a fix', 'fix(core): b', /its type fix shows/],
    ['a breaking ci', 'ci!: drop node 20', /breaking change/],
    ['a BREAKING CHANGE footer', 'refactor: b\n\nBREAKING CHANGE: b is gone', /BREAKING CHANGE or Release-As footer/],
    ['a Release-As footer', 'chore: b\n\nRelease-As: 2.0.0', /BREAKING CHANGE or Release-As footer/],
    ['a subject that is not Conventional', 'Merge branch x', /not a Conventional Commits subject/],
  ];
  for (const [name, message, why] of shown) {
    it(`refuses a move by ${name} and leaves the release branch as it was`, () => {
      const { sha, tip } = moveMain(['src/b.ts', 'export const b = 2;\n', message]);

      const caught = catchUp(sha, tip);

      assert.equal(caught.kind, 'refused');
      assert.ok(caught.kind === 'refused');
      assert.match(caught.reason, why);
      assert.match(caught.reason, /the release tool rewrites that head/);
      assert.equal(onOrigin(RELEASE), sha);
    });
  }

  it("refuses a hidden-type move that edits release-please's manifest", () => {
    const { sha, tip } = moveMain(['.release-please-manifest.json', '{ ".": "1.0.0" }\n', 'chore: seed the manifest']);

    assert.match(releaseMoveRefusal(git, sha, tip) ?? '', /edits release-please-config\.json or \.release-please-manifest\.json/);
  });

  it('refuses any move once the config sets its own changelog sections', () => {
    const { sha, tip } = moveMain(['release-please-config.json', '{ "changelog-sections": [] }\n', 'chore: show chores']);

    assert.match(releaseMoveRefusal(git, sha, tip) ?? '', /sets its own changelog-sections/);
  });

  it('refuses a rebase that conflicts, with no rebase left in progress', () => {
    const { sha, tip } = moveMain(['CHANGELOG.md', '# Changes\n', 'docs: a changelog of our own']);

    const caught = catchUp(sha, tip);

    assert.ok(caught.kind === 'refused');
    assert.match(caught.reason, /conflicts/);
    assert.equal(git('status', '--porcelain'), '');
    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
    assert.equal(onOrigin(RELEASE), sha);
  });

  it('refuses a repo dir with uncommitted changes before it switches anything', () => {
    const { sha, tip } = moveMain(['.github/ci.yml', 'on: push\n', 'ci: cache downloads']);
    repo.write('scratch.txt', 'mine\n');

    const caught = catchUp(sha, tip);

    assert.ok(caught.kind === 'refused');
    assert.match(caught.reason, /uncommitted changes/);
    assert.equal(onOrigin(RELEASE), sha);
  });

  it('never overwrites a head the release tool pushed meanwhile: the lease is on the approved sha', () => {
    const { sha, tip } = moveMain(['.github/ci.yml', 'on: push\n', 'ci: cache downloads']);
    git('switch', '-q', '-c', 'rewrite', sha);
    const rewritten = commit('CHANGELOG.md', '# Changelog\n\n## 1.2.0\n', 'chore(main): release 1.2.0');
    git('push', '-q', '--force', 'origin', `HEAD:refs/heads/${RELEASE}`);
    git('switch', '-q', 'main');

    const caught = catchUp(sha, tip);

    assert.ok(caught.kind === 'refused');
    assert.match(caught.reason, /pushing it rebased to release-please--branches--main failed/);
    assert.equal(onOrigin(RELEASE), rewritten);
    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  });
});
