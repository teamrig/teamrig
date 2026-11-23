import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RepoTokens } from '../adapters/connectors/github/tokens.ts';
import type { ProgramRequest, ProgramResult } from '../core/program-runner.ts';
import { FakeCredentials, ownerToken, TEST_OWNERS } from '../testing/fake-credentials.ts';
import type { GithubRepos } from '../hooks/gh-write-refusals.ts';
import { ghPass, type GhPassOutcome, type GhPassPorts } from './gh-pass.ts';

/** A program runner that answers `git remote -v` with a listing and `gh` with one result, recording every request. */
class FakePrograms {
  readonly requests: ProgramRequest[] = [];
  remotes = 'origin\thttps://github.com/acme/web.git (fetch)\norigin\thttps://github.com/acme/web.git (push)\n';
  gh: ProgramResult = { end: { kind: 'exited', code: 0 }, stdout: 'ok\n', stderr: '' };

  readonly run = async (request: ProgramRequest): Promise<ProgramResult> => {
    this.requests.push(request);
    if (request.program === 'git') {
      return { end: { kind: 'exited', code: 0 }, stdout: this.remotes, stderr: '' };
    }
    return this.gh;
  };

  /** The gh runs, without the git reads. */
  ghRuns(): ProgramRequest[] {
    return this.requests.filter((request) => request.program === 'gh');
  }
}

/** Every line printed, by stream. */
class Printed {
  readonly stdoutLines: string[] = [];
  readonly stderrLines: string[] = [];
  stdout(line: string): void {
    this.stdoutLines.push(line);
  }
  stderr(line: string): void {
    this.stderrLines.push(line);
  }
}

const TEAM: GithubRepos = { kind: 'repos', repos: new Set(['acme/web']) };

interface Setup {
  readonly programs: FakePrograms;
  readonly printed: Printed;
  readonly credentials: FakeCredentials;
  readonly ports: GhPassPorts;
}

function setup(options: { readonly env?: Record<string, string>; readonly github?: GithubRepos } = {}): Setup {
  const programs = new FakePrograms();
  const printed = new Printed();
  const credentials = new FakeCredentials().savesTokensFor(TEST_OWNERS);
  const base = { PATH: '/bin', GITHUB_TOKEN: 'session-held' };
  const ports: GhPassPorts = {
    run: programs.run,
    keys: new RepoTokens(credentials, { PATH: '/bin' }),
    env: { ...base, ...options.env },
    cwd: 'C:/w',
    github: options.github ?? TEAM,
    out: printed,
  };
  return { programs, printed, credentials, ports };
}

function refusalOf(outcome: GhPassOutcome): string {
  assert.equal(outcome.kind, 'refused');
  return outcome.kind === 'refused' ? outcome.why : '';
}

describe('ghPass: the key of the owner a gh call reaches (T4897)', () => {
  it('runs a read named with -R on that owner’s saved key, and nothing else', async () => {
    const { programs, printed, ports } = setup();
    const outcome = await ghPass(['pr', 'view', '5', '-R', 'globex/api'], ports);
    assert.deepEqual(outcome, { kind: 'ran', ok: true });
    const [run] = programs.ghRuns();
    assert.deepEqual(run?.args, ['pr', 'view', '5', '-R', 'globex/api']);
    assert.deepEqual(run?.env, { PATH: '/bin', GH_TOKEN: ownerToken('globex') });
    assert.deepEqual(printed.stdoutLines, ['ok']);
  });

  it('places gh api by its repos/, orgs/ or users/ path', async () => {
    for (const [path, owner] of [
      ['repos/globex/api/pulls', 'globex'],
      ['/orgs/GLOBEX/teams', 'globex'],
      ['users/acme/repos', 'acme'],
      ['https://api.github.com/repos/globex/api', 'globex'],
    ] as const) {
      const { programs, ports } = setup();
      assert.deepEqual(await ghPass(['api', path], ports), { kind: 'ran', ok: true }, path);
      assert.equal(programs.ghRuns()[0]?.env?.['GH_TOKEN'], ownerToken(owner), path);
    }
  });

  it('places gh repo view by its repository word, past its flags', async () => {
    const { programs, ports } = setup();
    await ghPass(['repo', 'view', '--json', 'name', 'globex/api'], ports);
    assert.equal(programs.ghRuns()[0]?.env?.['GH_TOKEN'], ownerToken('globex'));
  });

  it('takes the folder’s remote when the words name none, and GH_REPO over it', async () => {
    const fromFolder = setup();
    await ghPass(['issue', 'list'], fromFolder.ports);
    assert.deepEqual(fromFolder.programs.requests[0]?.args, ['-C', 'C:/w', 'remote', '-v']);
    assert.equal(fromFolder.programs.ghRuns()[0]?.env?.['GH_TOKEN'], ownerToken('acme'));

    const fromVariable = setup({ env: { GH_REPO: 'globex/api' } });
    await ghPass(['issue', 'list'], fromVariable.ports);
    assert.equal(fromVariable.programs.requests.filter((request) => request.program === 'git').length, 0);
    assert.equal(fromVariable.programs.ghRuns()[0]?.env?.['GH_TOKEN'], ownerToken('globex'));
  });

  it('refuses a call it cannot place on one owner, before any key is read', async () => {
    const twoOwners = setup();
    twoOwners.programs.remotes = 'origin\thttps://github.com/acme/web.git (fetch)\nupstream\thttps://github.com/globex/web.git (fetch)\n';
    assert.match(refusalOf(await ghPass(['issue', 'list'], twoOwners.ports)), /acme, globex: one run uses one owner's key/u);
    assert.deepEqual(twoOwners.credentials.reads, []);

    const noRemote = setup();
    noRemote.programs.remotes = '';
    assert.match(refusalOf(await ghPass(['issue', 'list'], noRemote.ports)), /no GitHub remote/u);

    const alias = setup();
    alias.programs.remotes = 'origin\tgit@work-gh:acme/web.git (fetch)\n';
    assert.match(refusalOf(await ghPass(['issue', 'list'], alias.ports)), /cannot read/u);

    const both = setup();
    assert.match(refusalOf(await ghPass(['pr', 'list', '-R', 'acme/web', '-R', 'globex/api'], both.ports)), /acme, globex/u);
    assert.equal(both.programs.ghRuns().length, 0);
  });

  it('refuses gh’s own login and settings, aliases and extensions, and every host but github.com', async () => {
    for (const args of [['auth', 'token'], ['config', 'set', 'editor', 'vi'], ['alias', 'set', 'x', 'y'], ['extension', 'install', 'o/n'], ['my-extension', '-R', 'acme/web'], ['--version'], []]) {
      const { programs, ports } = setup();
      refusalOf(await ghPass(args, ports));
      assert.equal(programs.ghRuns().length, 0, args.join(' '));
    }
    assert.match(refusalOf(await ghPass(['api', '--hostname', 'ghe.example', 'repos/acme/web'], setup().ports)), /--hostname/u);
    assert.match(refusalOf(await ghPass(['api', 'https://ghe.example/api/v3/repos/acme/web'], setup().ports)), /ghe\.example/u);
    assert.match(refusalOf(await ghPass(['pr', 'list', '-R', 'acme/web'], setup({ env: { GH_HOST: 'ghe.example' } }).ports)), /GH_HOST/u);
  });

  it('leaves a write on a team repository to teamrig’s own command, and runs one elsewhere', async () => {
    const team = setup();
    assert.match(refusalOf(await ghPass(['pr', 'merge', '5'], team.ports)), /acme\/web, a repository of the team/u);
    assert.equal(team.programs.ghRuns().length, 0);

    const elsewhere = setup();
    assert.deepEqual(await ghPass(['issue', 'comment', '7', '-R', 'globex/api', '--body', 'x'], elsewhere.ports), { kind: 'ran', ok: true });

    const unknown = setup({ github: { kind: 'unknown', why: 'the team config did not load' } });
    assert.match(refusalOf(await ghPass(['issue', 'close', '7', '-R', 'globex/api'], unknown.ports)), /did not load/u);
    assert.deepEqual(await ghPass(['issue', 'view', '7', '-R', 'globex/api'], unknown.ports), { kind: 'ran', ok: true });
  });

  it('refuses an owner with no saved key, never falling back to the gh login', async () => {
    const { programs, ports } = setup();
    assert.match(refusalOf(await ghPass(['repo', 'view', 'initech/app'], ports)), /no token for initech/u);
    assert.equal(programs.ghRuns().length, 0);
  });

  it('runs a call that reaches one repository on that repository’s own key, and one reaching more on the owner’s', async () => {
    const one = setup();
    one.credentials.saves('teamrig-gh-globex.api', 'api-key');
    await ghPass(['pr', 'view', '5', '-R', 'Globex/API'], one.ports);
    await ghPass(['api', 'repos/globex/api/pulls'], one.ports);
    await ghPass(['api', 'repos/globex/api.git/issues'], one.ports);
    assert.deepEqual(one.programs.ghRuns().map((run) => run.env?.['GH_TOKEN']), ['api-key', 'api-key', 'api-key']);

    const more = setup();
    more.credentials.saves('teamrig-gh-globex.api', 'api-key');
    await ghPass(['pr', 'list', '-R', 'globex/site', '-R', 'globex/docs'], more.ports);
    await ghPass(['api', 'orgs/globex/teams'], more.ports);
    assert.deepEqual(more.programs.ghRuns().map((run) => run.env?.['GH_TOKEN']), [ownerToken('globex'), ownerToken('globex')]);
    assert.ok(!more.credentials.reads.includes('teamrig-gh-globex.api'));
  });

  it('refuses a call reaching several repositories of one owner when one has its own key, never reading the owner’s', async () => {
    const flags = setup();
    flags.credentials.saves('teamrig-gh-globex.api', 'api-key');
    assert.match(refusalOf(await ghPass(['pr', 'list', '-R', 'globex/site', '-R', 'globex/api'], flags.ports)), /globex\/api has a key of its own/u);
    assert.ok(!flags.credentials.reads.includes('teamrig-gh-globex'));
    assert.equal(flags.programs.ghRuns().length, 0);

    const folder = setup();
    folder.credentials.saves('teamrig-gh-acme.web', 'web-key');
    folder.programs.remotes = 'origin\thttps://github.com/acme/web.git (fetch)\nfork\thttps://github.com/acme/web-fork.git (fetch)\n';
    assert.match(refusalOf(await ghPass(['issue', 'list'], folder.ports)), /acme\/web has a key of its own/u);
    assert.equal(folder.programs.ghRuns().length, 0);

    const locked = setup();
    locked.credentials.failsOn('teamrig-gh-globex.api', 'the keyring is locked');
    assert.match(refusalOf(await ghPass(['pr', 'list', '-R', 'globex/site', '-R', 'globex/api'], locked.ports)), /could not read teamrig-gh-globex\.api/u);
    assert.ok(!locked.credentials.reads.includes('teamrig-gh-globex'));
    assert.equal(locked.programs.ghRuns().length, 0);
  });

  it('refuses a gh api path with a `.`, `..` or `%` segment, or a repos/ path naming no repository, before any key is read', async () => {
    for (const path of ['repos/globex/x/../api', 'repos/globex/%61pi', 'repos/globex/./api/pulls', 'repos/glo$bex/api']) {
      const { programs, credentials, ports } = setup();
      refusalOf(await ghPass(['api', path], ports));
      assert.deepEqual(credentials.reads, [], path);
      assert.equal(programs.ghRuns().length, 0, path);
    }
  });

  it('refuses a -R, gh repo or GH_REPO value on a host other than github.com, and a folder with a *.ghe.com remote', async () => {
    for (const [args, env] of [
      [['pr', 'list', '-R', 'x.ghe.com/acme/web'], {}],
      [['pr', 'list', '-R', 'https://x.ghe.com/acme/web'], {}],
      [['repo', 'view', 'x.ghe.com/acme/web'], {}],
      [['issue', 'list'], { GH_REPO: 'x.ghe.com/acme/web' }],
    ] as const) {
      const { programs, credentials, ports } = setup({ env });
      refusalOf(await ghPass(args, ports));
      assert.deepEqual(credentials.reads, [], args.join(' '));
      assert.equal(programs.ghRuns().length, 0, args.join(' '));
    }
    const github = setup();
    assert.deepEqual(await ghPass(['pr', 'list', '-R', 'github.com/globex/api'], github.ports), { kind: 'ran', ok: true });

    const tenant = setup();
    tenant.programs.remotes = 'origin\thttps://github.com/acme/web.git (fetch)\nwork\thttps://x.ghe.com/acme/web.git (fetch)\n';
    assert.match(refusalOf(await ghPass(['issue', 'list'], tenant.ports)), /\*\.ghe\.com/u);
    assert.deepEqual(tenant.credentials.reads, []);
  });

  it('refuses a call whose repository key is saved but cannot be read, never running on the owner’s key', async () => {
    const { programs, credentials, ports } = setup();
    credentials.failsOn('teamrig-gh-globex.api', 'the keyring is locked');
    assert.match(refusalOf(await ghPass(['pr', 'view', '5', '-R', 'globex/api'], ports)), /could not read teamrig-gh-globex\.api/u);
    assert.equal(programs.ghRuns().length, 0);
  });

  it('passes gh’s failure on, naming the key when gh says it lacks a right', async () => {
    const { programs, printed, ports } = setup();
    programs.gh = { end: { kind: 'exited', code: 1 }, stdout: '', stderr: 'HTTP 403: Resource not accessible by personal access token\n' };
    assert.deepEqual(await ghPass(['pr', 'view', '5', '-R', 'globex/api'], ports), { kind: 'ran', ok: false });
    assert.equal(printed.stderrLines[0], 'HTTP 403: Resource not accessible by personal access token');
    assert.match(printed.stderrLines[1] ?? '', /key saved for globex; it may lack the right or be expired: save a new one with: save /u);
  });
});
