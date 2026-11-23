import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runsOf } from '../package-guard/programs.ts';
import { ghReadRefusals } from './gh-read-refusals.ts';
import type { GhWriteEnv } from './gh-write-refusals.ts';

/** A team whose one GitHub repository is acme/web, run from its checkout C:/w. */
const TEAM: GhWriteEnv = {
  github: { kind: 'repos', repos: new Set(['acme/web']) },
  remotesOf: (dir) => (dir.replaceAll('\\', '/') === 'C:/w' ? ['acme/web'] : undefined),
  ghRepo: undefined,
};

/** The same team, run from a contributor's fork. */
const FORK: GhWriteEnv = { ...TEAM, remotesOf: () => ['someone/fork'] };

function refusals(line: string, env: GhWriteEnv = TEAM, dialect: 'bash' | 'powershell' = 'bash'): string[] {
  return ghReadRefusals(runsOf(line, { cwd: 'C:/w', home: 'C:/u', dialect }), env);
}

/** The one refusal a line gets. */
function refusal(line: string, env: GhWriteEnv = TEAM, dialect: 'bash' | 'powershell' = 'bash'): string {
  const found = refusals(line, env, dialect);
  assert.equal(found.length, 1, `${line}: ${found.join(' | ')}`);
  return found[0] ?? '';
}

describe('ghReadRefusals: a read on a team owner (T4896)', () => {
  it('refuses a read naming a repository of a team owner, any of its repositories, and names the teamrig gh line', () => {
    for (const [line, what, route] of [
      ['gh issue view 7 -R acme/web', 'gh issue view', 'teamrig gh -- issue view 7 -R acme/web'],
      ['gh api repos/acme/other/pulls', 'gh api', 'teamrig gh -- api repos/acme/other/pulls'],
      ['gh repo view Acme/Web', 'gh repo view', 'teamrig gh -- repo view Acme/Web'],
      ['gh api orgs/acme/repos', 'gh api', 'teamrig gh -- api orgs/acme/repos'],
    ] as const) {
      const why = refusal(line, FORK);
      assert.equal(why, `\`${what}\` reads acme's repositories with this machine's own gh login, which may be another project's key. Run it on the key the team saved for acme: \`${route}\`.`, line);
    }
  });

  it('lets a read on another owner pass', () => {
    for (const line of ['gh issue view 7 -R someone/fork', 'gh api repos/someone/fork/pulls', 'gh pr list', 'gh api user']) {
      assert.deepEqual(refusals(line, FORK), [], line);
    }
  });

  it('refuses a read the folder places on a team owner, the T4896 proof target', () => {
    assert.ok(refusal('gh api user').endsWith('Run it on the key the team saved for acme: `teamrig gh -- api user`.'));
    assert.ok(refusal('gh pr list --state open').startsWith('`gh pr list` reads acme\'s repositories'));
    assert.ok(refusal('gh pr list', { ...FORK, ghRepo: 'acme/web' }).startsWith('`gh pr list` reads acme\'s'));
    assert.deepEqual(refusals('gh pr list', { ...TEAM, ghRepo: 'someone/fork' }), []);
  });

  it('refuses a folder read it cannot place, and lets one pass from a folder with no GitHub remote', () => {
    for (const [line, env] of [
      ['GH_REPO=x/y gh pr list', TEAM],
      ['git remote set-url origin https://github.com/acme/web && gh pr list', FORK],
      ['gh pr list', { ...TEAM, remotesOf: () => undefined }],
    ] as const) {
      assert.ok(refusal(line, env).startsWith('`gh pr list` reads the repository of the folder it runs in (or `GH_REPO`) with this machine\'s own gh login, and the guard cannot tell which it is'), line);
    }
    assert.deepEqual(refusals('gh pr list', { ...TEAM, remotesOf: () => [] }), []);
  });

  it('quotes a word with blanks or quotes for the dialect the line ran in', () => {
    assert.ok(refusal("gh issue list -R acme/web --search 'is:open label:bug'").endsWith("`teamrig gh -- issue list -R acme/web --search 'is:open label:bug'`."));
    assert.ok(refusal('gh issue list -R acme/web --search "it\'s"').endsWith("`teamrig gh -- issue list -R acme/web --search 'it'\\''s'`."));
    assert.ok(refusal('gh issue list -R acme/web --search "it\'s"', TEAM, 'powershell').endsWith("`teamrig gh -- issue list -R acme/web --search 'it''s'`."));
  });

  it('reads a program only known when it runs as gh only when its words name a team owner', () => {
    assert.ok(refusal('$GH pr view 5 -R acme/web').startsWith('`gh pr view` reads acme\'s repositories'));
    for (const line of ['$GH api user', '$NPM run list', '$GH pr view 5 -R someone/fork', '$T issue similar acme/web#7']) {
      assert.deepEqual(refusals(line), [], line);
    }
  });

  it('leaves writes to the write check, and passes a call teamrig gh would refuse itself', () => {
    for (const line of ['gh issue close 7 -R acme/web', 'gh pr merge 3', 'gh auth status', 'gh --version', 'gh', 'gh api --hostname ghe.example user', 'gh mymerge 3']) {
      assert.deepEqual(refusals(line), [], line);
    }
  });

  it('lets every read pass on a team whose GitHub repositories are none or unknown', () => {
    for (const github of [{ kind: 'none' }, { kind: 'unknown', why: 'the team config did not load' }] as const) {
      assert.deepEqual(refusals('gh issue view 7 -R acme/web', { ...TEAM, github }), [], github.kind);
    }
  });
});
