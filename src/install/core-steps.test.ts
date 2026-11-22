import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ConfigLoad } from '../config/load.ts';
import { compareVersions, parseVersion } from '../core/release-version.ts';
import { KIT_VERSION } from '../core/version.ts';
import type { RequirementProblem, RequirementsCheck } from '../requirements/requirements.ts';
import { testConfig } from '../testing/config.ts';
import { FakePathProbe } from '../testing/fake-processes.ts';
import { CLI_STEP, CORE_STEPS, GIT_STEP, NODE_STEP, TEAM_STEP, type CoreStepDeps, type TeamLook } from './core-steps.ts';

function requirements(problems: readonly RequirementProblem[]): RequirementsCheck {
  return { problems: async () => problems };
}

const FOUND_TEAM: TeamLook = { kind: 'found', team: 'alpha', load: { status: 'loaded', path: 'C:\\teams\\alpha\\config.json', config: testConfig(), issues: [] } };

function deps(overrides: Partial<CoreStepDeps> = {}): CoreStepDeps {
  return {
    env: { PATH: 'C:\\plugin\\bin' },
    platform: 'win32',
    probe: new FakePathProbe({ files: ['C:\\plugin\\bin\\teamrig.cmd'] }),
    requirements: requirements([]),
    script: 'C:\\plugin\\dist\\cli\\main.js',
    team: FOUND_TEAM,
    ...overrides,
  };
}

describe('CORE_STEPS', () => {
  it('lists Node.js, git, the CLI, then the team, each id once', () => {
    assert.deepEqual(
      CORE_STEPS.map((step) => step.id),
      ['node', 'git', 'cli', 'team'],
    );
  });

  it('names for each step the release that first needed it, none later than this one', () => {
    const current = parseVersion(KIT_VERSION);
    assert.ok(current !== undefined, KIT_VERSION);
    for (const step of CORE_STEPS) {
      assert.ok(compareVersions(step.addedIn, current) <= 0, step.id);
    }
  });

  it('all pass on a machine that has everything', async () => {
    for (const step of CORE_STEPS) {
      assert.equal((await step.probe(deps())).kind, 'ok', step.id);
    }
  });
});

describe('NODE_STEP', () => {
  it('is missing, with the running version and the fix, on an old Node.js', async () => {
    const state = await NODE_STEP.probe(deps({ requirements: requirements([{ kind: 'git-missing' }, { kind: 'node-old', running: '20.1.0' }]) }));
    assert.equal(state.kind, 'missing');
    assert.match(state.kind === 'missing' ? `${state.detail} | ${state.fix}` : '', /Node\.js 20\.1\.0 runs teamrig \| install the current Node\.js LTS/);
  });

  it('is unknown when the Node.js check failed, and ignores a failed git check', async () => {
    const failed: RequirementProblem = { kind: 'check-failed', requirement: 'Node.js', reason: 'no version' };
    assert.deepEqual(await NODE_STEP.probe(deps({ requirements: requirements([failed]) })), { kind: 'unknown', why: 'no version' });
    const gitFailed: RequirementProblem = { kind: 'check-failed', requirement: 'git', reason: 'PATH unreadable' };
    assert.equal((await NODE_STEP.probe(deps({ requirements: requirements([gitFailed]) }))).kind, 'ok');
  });
});

describe('GIT_STEP', () => {
  it('is missing with the install fix when no git is on PATH', async () => {
    assert.deepEqual(await GIT_STEP.probe(deps({ requirements: requirements([{ kind: 'git-missing' }]) })), {
      kind: 'missing',
      detail: 'no git on PATH',
      fix: 'install git from git-scm.com, then start a new session',
    });
  });

  it('is unknown when the git check failed', async () => {
    const failed: RequirementProblem = { kind: 'check-failed', requirement: 'git', reason: 'PATH unreadable' };
    assert.deepEqual(await GIT_STEP.probe(deps({ requirements: requirements([failed]) })), { kind: 'unknown', why: 'PATH unreadable' });
  });
});

describe('CLI_STEP', () => {
  it('finds this install’s .cmd shim on Windows, the folder in any case', async () => {
    assert.deepEqual(await CLI_STEP.probe(deps({ script: 'C:\\Plugin\\dist\\cli\\main.js' })), { kind: 'ok', detail: 'C:\\plugin\\bin\\teamrig.cmd' });
  });

  it('is missing, naming the bin folder to add, when no teamrig is on PATH', async () => {
    const state = await CLI_STEP.probe(deps({ probe: new FakePathProbe() }));
    assert.equal(state.kind, 'missing');
    assert.match(state.kind === 'missing' ? state.fix : '', /add C:\\plugin\\bin to PATH/);
  });

  it('is missing when the teamrig on PATH is another install’s', async () => {
    const state = await CLI_STEP.probe(deps({ env: { PATH: 'C:\\old\\bin' }, probe: new FakePathProbe({ files: ['C:\\old\\bin\\teamrig.cmd'] }) }));
    assert.equal(state.kind, 'missing');
    assert.match(state.kind === 'missing' ? state.detail : '', /C:\\old\\bin\\teamrig\.cmd\) is another install/);
  });

  it('reads POSIX paths with their case on a POSIX host', async () => {
    const posix = { env: { PATH: '/opt/plugin/bin' }, platform: 'linux' as const, script: '/opt/plugin/dist/cli/main.js' };
    assert.deepEqual(await CLI_STEP.probe(deps({ ...posix, probe: new FakePathProbe({ files: ['/opt/plugin/bin/teamrig'] }) })), {
      kind: 'ok',
      detail: '/opt/plugin/bin/teamrig',
    });
    const otherCase = await CLI_STEP.probe(deps({ ...posix, script: '/opt/Plugin/dist/cli/main.js', probe: new FakePathProbe({ files: ['/opt/plugin/bin/teamrig'] }) }));
    assert.equal(otherCase.kind, 'missing');
  });
});

describe('TEAM_STEP', () => {
  const load = (value: ConfigLoad): TeamLook => ({ kind: 'found', team: 'alpha', load: value });

  it('is ok on a config that loads with no issue', async () => {
    assert.deepEqual(await TEAM_STEP.probe(deps()), { kind: 'ok', detail: 'team alpha, config C:\\teams\\alpha\\config.json' });
  });

  it('is missing with the refusal as its fix when no team is found', async () => {
    assert.deepEqual(await TEAM_STEP.probe(deps({ team: { kind: 'none', why: 'no team here: run teamrig team create' } })), {
      kind: 'missing',
      detail: 'no team found from here',
      fix: 'no team here: run teamrig team create',
    });
  });

  it('is missing with the create line when the config file is not there', async () => {
    const state = await TEAM_STEP.probe(deps({ team: load({ status: 'missing', path: 'C:\\teams\\alpha\\config.json' }) }));
    assert.deepEqual(state, { kind: 'missing', detail: 'no config at C:\\teams\\alpha\\config.json', fix: 'teamrig team create alpha --sessions <id,id>' });
  });

  it('is missing with the problem when the config cannot be read', async () => {
    const unreadable: ConfigLoad = { status: 'unreadable', path: 'C:\\teams\\alpha\\config.json', issue: { path: '', message: 'not JSON' } };
    const state = await TEAM_STEP.probe(deps({ team: load(unreadable) }));
    assert.equal(state.kind, 'missing');
    assert.match(state.kind === 'missing' ? state.detail : '', /cannot be read: not JSON/);
  });

  it('is missing with config validate as the fix when the config has problems', async () => {
    const issues = [{ path: 'roles.lead', message: 'not a session' }];
    const state = await TEAM_STEP.probe(deps({ team: load({ status: 'loaded', path: 'C:\\teams\\alpha\\config.json', config: testConfig(), issues }) }));
    assert.deepEqual(state, {
      kind: 'missing',
      detail: 'the config at C:\\teams\\alpha\\config.json has 1 problem(s), defaults used',
      fix: 'teamrig config validate',
    });
  });
});
