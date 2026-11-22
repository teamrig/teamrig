import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HostSource } from '../composition/host-ports.ts';
import { isUnsupported, type HostPorts } from '../ports/host/index.ts';
import type { SecretGuardConfig } from '../config/types.ts';
import { CREDENTIAL_VARIABLES } from '../core/child-env.ts';
import { DEFAULT_SECRET_PATHS } from '../secret-guard/paths.ts';
import { secretRulesOf } from '../secret-guard/rules.ts';
import { bareHost } from '../testing/bare-host.ts';
import { HOOKS_ONLY_HOST, hostNaming, hostReadingLines, hostRunning, hostStarting, NO_PATHS_HOST, SHIPPED_HOST, testPaths } from '../testing/host.ts';
import { quietWorld } from '../testing/quiet-world.ts';
import { shippedModels } from '../testing/shipped-models.ts';
import { shippedSteps } from '../testing/shipped-steps.ts';
import { join } from 'node:path';
import {
  childEnvOf,
  contextSourceIfTold,
  hooksOf,
  hostHomeIfKnown,
  hostHomeOf,
  hostNameOf,
  hostOf,
  identityOf,
  launcherIfTold,
  launcherOf,
  launchHostFrom,
  launchHostOf,
  leadLaunchFrom,
  leadLaunchOf,
  modelsIfKnown,
  pathsIfKnown,
  pathsOf,
  secretFilesOf,
  sessionCommandLinesOf,
  sessionProcessCheckOf,
  sessionVariablesOf,
  stepsIfKnown,
  stepsOf,
  transcriptsIfKept,
  transcriptsOf,
  usageIfMetered,
  usageOf,
} from './host.ts';
import { RefusedError } from './runtime.ts';

/** One bare host, kept so a case can tell the very ports it handed in from a copy. */
const BARE: HostPorts = bareHost();
const bare: HostSource = () => BARE;
const OUTPUT_ONLY = { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheWriteUnsplit: 0, cacheRead: 0, output: 2 };
const USER_HOME = join('/', 'people', 'sam');

describe('hostOf', () => {
  it('builds the ports from the environment and platform of the run it is asked for', () => {
    const seen: Parameters<HostSource>[0][] = [];
    const host: HostSource = (given) => {
      seen.push(given);
      return BARE;
    };
    assert.equal(hostOf({ host, env: { RUN: 'one' }, platform: 'win32' }), BARE);
    assert.deepEqual(seen, [{ env: { RUN: 'one' }, platform: 'win32' }]);
  });

  it('gives a spec in the quiet world the shipped host, its transcript reader and usage meter filled', () => {
    const world = quietWorld();
    const { transcripts, usage } = hostOf({ host: world.host, env: {}, platform: world.platform });
    assert.equal(isUnsupported(transcripts), false);
    assert.deepEqual(!isUnsupported(transcripts) && transcripts.entry('not a transcript line'), { kind: 'unread', reason: 'damaged' });
    assert.equal(isUnsupported(usage), false);
  });
});

describe('hooksOf', () => {
  it('gives the bridge of the host the run is in', () => {
    const world = quietWorld();
    const hooks = hooksOf({ host: world.host, env: {}, platform: world.platform });
    assert.equal(hooks.parse('{"prompt":"hello"}')?.prompt, 'hello');
  });

  it('refuses with the reason of a host that calls no hook', () => {
    assert.throws(() => hooksOf({ host: bare, env: {}, platform: 'linux' }), (error) => error instanceof RefusedError && error.message === 'no hook is called');
  });
});

describe('transcriptsIfKept', () => {
  it('gives the reader of a host that has one, and nothing for a host that keeps no transcript', () => {
    const world = quietWorld();
    assert.deepEqual(transcriptsIfKept({ host: world.host, env: {}, platform: world.platform })?.entry('not a transcript line'), { kind: 'unread', reason: 'damaged' });
    assert.equal(transcriptsIfKept({ host: bare, env: {}, platform: 'linux' }), undefined);
  });
});

describe('stepsIfKnown', () => {
  it('gives the steps of a host that names them, and nothing for a host that names none', () => {
    const world = quietWorld();
    assert.equal(stepsIfKnown({ host: world.host, env: {}, platform: world.platform })?.exit, shippedSteps().exit);
    assert.equal(stepsIfKnown({ host: bare, env: {}, platform: 'linux' }), undefined);
  });
});

describe('modelsIfKnown', () => {
  it('gives the models of a host that knows them, and nothing for a host that knows none', () => {
    const world = quietWorld();
    const known = modelsIfKnown({ host: world.host, env: {}, platform: world.platform });
    assert.equal(known?.defaultName, shippedModels().defaultName);
    assert.equal(modelsIfKnown({ host: bare, env: {}, platform: 'linux' }), undefined);
  });
});

describe('leadLaunchOf', () => {
  it("gives the host's lead default, and nothing on a host that knows no models", () => {
    const world = quietWorld();
    const { model, effort } = shippedModels().leadDefault;
    assert.deepEqual(leadLaunchOf({ host: world.host, env: {}, platform: world.platform }), { model, effort });
    assert.deepEqual(leadLaunchOf({ host: bare, env: {}, platform: 'linux' }), {});
  });

  it("keeps the model but drops an effort that is no level on teamrig's scale", () => {
    const models = { ...shippedModels(), leadDefault: { model: 'model-one', effort: 'turbo' } };
    assert.deepEqual(leadLaunchFrom(models), { model: 'model-one' });
  });
});

describe('launchHostOf', () => {
  it("gives the host's lead default and its check of a model name", () => {
    const world = quietWorld();
    const host = launchHostOf({ host: world.host, env: {}, platform: world.platform });
    assert.deepEqual(host.leadDefault, leadLaunchFrom(shippedModels()));
    assert.equal(host.modelProblem('gpt-5'), shippedModels().problemOf('gpt-5'));
    assert.notEqual(host.modelProblem('gpt-5'), undefined);
    assert.equal(host.modelProblem('opus'), undefined);
  });

  it('takes any model name and gives no lead default on a host that knows no models', () => {
    const host = launchHostOf({ host: bare, env: {}, platform: 'linux' });
    assert.deepEqual(host.leadDefault, {});
    assert.equal(host.modelProblem('gpt-5'), undefined);
    assert.deepEqual(launchHostFrom(undefined).leadDefault, {});
  });
});

describe('transcriptsOf', () => {
  it('gives the reader of a host that has one', () => {
    const world = quietWorld();
    assert.deepEqual(transcriptsOf({ host: world.host, env: {}, platform: world.platform }).entry('not a transcript line'), { kind: 'unread', reason: 'damaged' });
  });

  it('refuses with the reason of a host that keeps no transcript', () => {
    assert.throws(
      () => transcriptsOf({ host: bare, env: {}, platform: 'linux' }),
      (error) => error instanceof RefusedError && error.message === 'no transcript is kept',
    );
  });
});

describe('usageIfMetered', () => {
  it('gives the meter of a host that has one, and nothing for a host whose calls cannot be priced', () => {
    const world = quietWorld();
    const meter = usageIfMetered({ host: world.host, env: {}, platform: world.platform });
    assert.equal(meter?.ofCall(OUTPUT_ONLY), 2 * (meter?.weights.output ?? Number.NaN));
    assert.equal(usageIfMetered({ host: bare, env: {}, platform: 'linux' }), undefined);
  });
});

describe('contextSourceIfTold', () => {
  it('gives the reader and the meter of a host that has both', () => {
    const world = quietWorld();
    const source = contextSourceIfTold({ host: world.host, env: {}, platform: world.platform });
    assert.deepEqual(source?.reader.entry('not a transcript line'), { kind: 'unread', reason: 'damaged' });
    assert.equal(source?.usage.contextReading({ ...OUTPUT_ONLY, input: 3, cacheRead: 4 }), 7);
  });

  it('gives nothing for a host lacking the reader or the meter', () => {
    const shipped = hostOf({ host: quietWorld().host, env: {}, platform: 'linux' });
    const noMeter: HostSource = () => ({ ...shipped, usage: BARE.usage });
    const noReader: HostSource = () => ({ ...shipped, transcripts: BARE.transcripts });
    assert.equal(contextSourceIfTold({ host: noMeter, env: {}, platform: 'linux' }), undefined);
    assert.equal(contextSourceIfTold({ host: noReader, env: {}, platform: 'linux' }), undefined);
  });
});

describe('usageOf', () => {
  it('gives the meter of a host that has one', () => {
    const world = quietWorld();
    const meter = usageOf({ host: world.host, env: {}, platform: world.platform });
    assert.equal(meter.ofCall(OUTPUT_ONLY), 2 * meter.weights.output);
  });

  it('refuses with the reason of a host whose calls cannot be priced', () => {
    assert.throws(
      () => usageOf({ host: bare, env: {}, platform: 'linux' }),
      (error) => error instanceof RefusedError && error.message === 'no call is priced',
    );
  });
});

describe('pathsIfKnown', () => {
  it('gives the paths of a host that tells them, built from the environment of the run, and nothing for a host that tells none', () => {
    const world = quietWorld();
    const moved = { CLAUDE_CODE_TMPDIR: join('/', 'scratch') };
    assert.equal(pathsIfKnown({ host: world.host, env: moved, platform: world.platform })?.scratchpads(join('/', 'tmp')), join('/', 'scratch', 'claude', '*', '*', 'scratchpad'));
    assert.equal(pathsIfKnown({ host: bare, env: moved, platform: 'linux' }), undefined);
  });
});

describe('pathsOf', () => {
  it('gives the paths of a host that tells them, built from the environment of the run', () => {
    const world = quietWorld();
    const moved = { CLAUDE_CONFIG_DIR: join('/', 'cfg') };
    assert.equal(pathsOf({ host: world.host, env: moved, platform: world.platform }).userSettings(USER_HOME), join('/', 'cfg', 'settings.json'));
  });

  it('refuses with the reason of a host whose folders are not known', () => {
    assert.throws(
      () => pathsOf({ host: bare, env: {}, platform: 'linux' }),
      (error) => error instanceof RefusedError && error.message === 'no folder of the host is known',
    );
  });
});

/**
 * The secret files the shipped host adapters name: the lines the guard's defaults held before the hosts told their
 * own, then the login in a folder named like Claude Code's own.
 */
const SHIPPED_SECRET_FILES = ['~/.claude/.credentials.json', '~/.claude/history.jsonl', '**/.claude/settings.local.json', '**/.claude*/.credentials.json'];

/**
 * The guard's default globs as they stood when it named the hosts' files itself, copied and not computed: under any
 * host the defaults with the hosts' files must still hold every one of them.
 */
const DEFAULTS_BEFORE_THE_PORT = [
  '**/.env',
  '**/.env.*',
  '!**/.env.example',
  '!**/.env.sample',
  '~/.npmrc',
  '~/.ssh/**',
  '!~/.ssh/*.pub',
  '~/.aws/credentials',
  '**/.kube/config',
  '~/.docker/config.json',
  '**/.git-credentials',
  '~/.config/gh/hosts.yml',
  '~/AppData/Roaming/GitHub CLI/hosts.yml',
  '~/.claude/.credentials.json',
  '~/.claude/history.jsonl',
  '**/.claude/settings.local.json',
  '~/.bash_history',
  '~/.zsh_history',
  '**/PSReadLine/*_history.txt',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/*.jks',
  '**/*.keystore',
  '**/id_rsa',
  '**/id_ecdsa',
  '**/id_ed25519',
  '**/*.tfstate',
  '**/*.tfstate.backup',
];

/** A host that names secret files of its own, one of them a shipped host's too. */
const OWN_FILES_HOST: HostSource = () => ({ ...BARE, paths: { ...testPaths(), secretFiles: () => ['~/.agent/login.json', '~/.claude/history.jsonl'] } });

/** The hosts a run may work in: the shipped one, ones telling none of their folders, and one naming files of its own. */
const RUNNING_HOSTS: readonly (readonly [string, HostSource])[] = [
  ['the shipped host', SHIPPED_HOST],
  ['a host with no port filled', bare],
  ['the shipped host telling no folder', NO_PATHS_HOST],
  ['a host with hooks only', HOOKS_ONLY_HOST],
  ['a host naming its own files', OWN_FILES_HOST],
];

describe('secretFilesOf', () => {
  it('gives the secret guard the files of every shipped host, whatever host the run works in', () => {
    const { shippedHosts, platform } = quietWorld();
    for (const [name, host] of RUNNING_HOSTS.slice(0, 4)) {
      assert.deepEqual(secretFilesOf({ host, shippedHosts, env: {}, platform }).secretFiles(), SHIPPED_SECRET_FILES, name);
    }
  });

  it('adds the files the running host names after the shipped ones, each glob once', () => {
    const { shippedHosts, platform } = quietWorld();
    assert.deepEqual(secretFilesOf({ host: OWN_FILES_HOST, shippedHosts, env: {}, platform }).secretFiles(), [...SHIPPED_SECRET_FILES, '~/.agent/login.json']);
    assert.deepEqual(secretFilesOf({ host: OWN_FILES_HOST, shippedHosts: [], env: {}, platform }).secretFiles(), ['~/.agent/login.json', '~/.claude/history.jsonl']);
    assert.deepEqual(secretFilesOf({ host: bare, shippedHosts: [bare, NO_PATHS_HOST], env: {}, platform }).secretFiles(), []);
  });

  it("gives the files a shipped host keeps in a folder the run's environment moves, under a host telling none of its folders too", () => {
    const { shippedHosts } = quietWorld();
    const env = { CLAUDE_CONFIG_DIR: '/cfg' };
    for (const [name, host] of RUNNING_HOSTS.slice(0, 4)) {
      assert.deepEqual(secretFilesOf({ host, shippedHosts, env, platform: 'linux' }).secretFiles(), [...SHIPPED_SECRET_FILES, '/cfg/.credentials.json', '/cfg/history.jsonl'], name);
    }
  });

  it('builds each host from the environment and platform of the run', () => {
    const seen: Parameters<HostSource>[0][] = [];
    const watching: HostSource = (given) => {
      seen.push(given);
      return BARE;
    };
    secretFilesOf({ host: watching, shippedHosts: [watching], env: { RUN: 'one' }, platform: 'darwin' });
    assert.deepEqual(seen, [
      { env: { RUN: 'one' }, platform: 'darwin' },
      { env: { RUN: 'one' }, platform: 'darwin' },
    ]);
  });

  it('keeps every default the guard had before the hosts told their own files, under each host', () => {
    const { shippedHosts, platform } = quietWorld();
    const config: SecretGuardConfig = { secretReads: 'deny', writes: 'deny', paths: [], envNames: [], commands: [], redact: true };
    for (const [name, host] of RUNNING_HOSTS) {
      const files = secretFilesOf({ host, shippedHosts, env: {}, platform });
      const globs = new Set([...DEFAULT_SECRET_PATHS, ...files.secretFiles()]);
      assert.deepEqual(DEFAULTS_BEFORE_THE_PORT.filter((glob) => !globs.has(glob)), [], name);
      const { paths } = secretRulesOf(config, '/u', 'linux', files);
      for (const path of ['/u/.claude/.credentials.json', '/u/.claude/history.jsonl', '/r/.claude/settings.local.json', '/r/.env', '/u/.ssh/id_ed25519']) {
        assert.equal(paths.listed(path), true, `${name}: ${path}`);
      }
    }
  });
});

describe('identityOf', () => {
  const PROJECT = join('/', 'work', 'app');
  const TOLD = { CLAUDE_PROJECT_DIR: PROJECT, CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_SESSION_KIND: 'bg' };
  const UNTOLD = { projectDir: undefined, startedAs: undefined, sessionKind: undefined, sessionId: undefined, forcedEffort: undefined };

  it('gives who the host says the run is, read from the environment of the run', () => {
    const world = quietWorld();
    assert.deepEqual(identityOf({ host: world.host, env: TOLD, platform: world.platform }), { ...UNTOLD, projectDir: PROJECT, startedAs: 'cli', sessionKind: 'bg' });
    assert.equal(identityOf({ host: world.host, env: { CLAUDE_CODE_EFFORT_LEVEL: 'low' }, platform: world.platform }).forcedEffort, 'low');
    assert.equal(identityOf({ host: world.host, env: { CLAUDE_CODE_SESSION_ID: 's-1' }, platform: world.platform }).sessionId, 's-1');
    assert.deepEqual(identityOf({ host: world.host, env: {}, platform: world.platform }), UNTOLD);
  });

  it('gives every part untold, and no refusal, on a host that tells nothing of its sessions, whatever the environment holds', () => {
    assert.deepEqual(identityOf({ host: bare, env: TOLD, platform: 'linux' }), UNTOLD);
    assert.deepEqual(identityOf({ host: HOOKS_ONLY_HOST, env: TOLD, platform: 'linux' }), UNTOLD);
  });

  it('asks the running host alone, with the environment and platform of the run', () => {
    const seen: Parameters<HostSource>[0][] = [];
    const telling: HostSource = (given) => {
      seen.push(given);
      const identity = { ...UNTOLD, projectDir: given.env['AGENT_ROOT'], startedAs: 'desk', sessionId: given.env['AGENT_SESSION'] };
      const childEnv = { session: [], parked: [], login: [] };
      const variables = { marks: ['AGENT_RUN'], identity: ['AGENT_SESSION', 'AGENT_ROOT'] };
      return { ...BARE, launcher: { programName: 'Agent', program: 'agent-desk', launchArgs: () => [], variables, childEnv, identity: () => identity, isSessionProcess: () => false, isForkOf: () => false, backgroundJobSession: () => undefined, sessionPlaceOf: () => undefined } };
    };
    assert.deepEqual(identityOf({ host: telling, env: { AGENT_ROOT: PROJECT, CLAUDE_PROJECT_DIR: join('/', 'other') }, platform: 'darwin' }), {
      ...UNTOLD,
      projectDir: PROJECT,
      startedAs: 'desk',
    });
    assert.deepEqual(seen, [{ env: { AGENT_ROOT: PROJECT, CLAUDE_PROJECT_DIR: join('/', 'other') }, platform: 'darwin' }]);
  });
});

describe('launcherOf and launcherIfTold', () => {
  const START = { name: 'app-alpha', model: undefined, effort: 'high', resume: undefined, settingsFile: undefined, prompt: 'Go on' };

  it("give the running host's own launcher: its program and the arguments it starts a session by", () => {
    const world = quietWorld();
    const shipped = launcherOf({ host: world.host, env: {}, platform: world.platform });
    assert.equal(shipped.program, 'claude');
    assert.deepEqual(shipped.launchArgs(START), ['--effort', 'high', '--name', 'app-alpha', 'Go on']);
    const desk = hostStarting('agent-desk', (start) => ['start', `--as=${start.name ?? ''}`]);
    for (const launcher of [launcherOf({ host: desk, env: {}, platform: 'linux' }), launcherIfTold({ host: desk, env: {}, platform: 'linux' })]) {
      assert.equal(launcher?.program, 'agent-desk');
      assert.deepEqual(launcher?.launchArgs(START), ['start', '--as=app-alpha']);
    }
  });

  it('refuse with the reason of a host that tells nothing of its sessions, or give none where the caller goes on', () => {
    assert.throws(
      () => launcherOf({ host: bare, env: {}, platform: 'linux' }),
      (error) => {
        const { launcher } = BARE;
        return error instanceof RefusedError && isUnsupported(launcher) && error.message === launcher.notice;
      },
    );
    assert.equal(launcherIfTold({ host: bare, env: {}, platform: 'linux' }), undefined);
    assert.equal(launcherIfTold({ host: HOOKS_ONLY_HOST, env: {}, platform: 'linux' }), undefined);
  });
});

describe('sessionVariablesOf', () => {
  const SHIPPED = { marks: ['CLAUDECODE'], identity: ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_PROJECT_DIR'] };
  const OTHER = hostNaming({ marks: ['OTHER_AGENT', 'CLAUDECODE'], identity: ['OTHER_SESSION', 'CLAUDE_PROJECT_DIR'] });

  it("holds every shipped host's variables whatever host the run works in: never fewer than the shipped host's own", () => {
    const { shippedHosts, platform } = quietWorld();
    for (const [name, host] of RUNNING_HOSTS) {
      assert.deepEqual(sessionVariablesOf({ host, shippedHosts, env: {}, platform }), SHIPPED, name);
    }
    assert.deepEqual(sessionVariablesOf({ host: hostNaming({ marks: [], identity: [] }), shippedHosts, env: {}, platform }), SHIPPED);
  });

  it('adds the variables the running host names after the shipped ones, each name once', () => {
    const { shippedHosts, platform } = quietWorld();
    assert.deepEqual(sessionVariablesOf({ host: OTHER, shippedHosts, env: {}, platform }), {
      marks: ['CLAUDECODE', 'OTHER_AGENT'],
      identity: ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'OTHER_SESSION'],
    });
    assert.deepEqual(sessionVariablesOf({ host: OTHER, shippedHosts: [], env: {}, platform }), { marks: ['OTHER_AGENT', 'CLAUDECODE'], identity: ['OTHER_SESSION', 'CLAUDE_PROJECT_DIR'] });
    assert.deepEqual(sessionVariablesOf({ host: bare, shippedHosts: [bare], env: {}, platform }), { marks: [], identity: [] });
  });
});

describe('childEnvOf', () => {
  const SHIPPED_SESSION = [
    'CLAUDECODE',
    'CLAUDE_CODE_SESSION_ID',
    'CLAUDE_CODE_CHILD_SESSION',
    'CLAUDE_CODE_ENTRYPOINT',
    'CLAUDE_CODE_EXECPATH',
    'CLAUDE_CODE_MESSAGING_SOCKET',
    'CLAUDE_CODE_MESSAGING_TOKEN',
    'CLAUDE_CODE_SESSION_ATTENDED',
    'CLAUDE_PID',
    'CLAUDE_PROJECT_DIR',
  ];
  const SHIPPED_PARKED = ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_PROJECT_DIR'];
  const SHIPPED_LOGIN = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];
  const OTHER = hostNaming({ marks: ['OTHER_AGENT'], identity: ['OTHER_SESSION', 'OTHER_ROOT'] }, {}, { session: ['OTHER_SOCKET', 'CLAUDE_PID'], parked: ['OTHER_SESSION', 'OTHER_TAB'], login: ['OTHER_KEY'] });

  it("leaves a child none of a shipped host's session variables and parks its marks, whatever host the run works in", () => {
    const { shippedHosts, platform } = quietWorld();
    for (const [name, host] of RUNNING_HOSTS) {
      const { session, parked } = childEnvOf({ host, shippedHosts, env: {}, platform });
      assert.deepEqual([session, parked], [SHIPPED_SESSION, SHIPPED_PARKED], name);
    }
  });

  it("keeps the running host's login alone: the shipped host's own, and none on a host that tells nothing of its sessions", () => {
    const { shippedHosts, platform } = quietWorld();
    assert.deepEqual(childEnvOf({ host: SHIPPED_HOST, shippedHosts, env: {}, platform }).login, SHIPPED_LOGIN);
    assert.deepEqual(childEnvOf({ host: OTHER, shippedHosts, env: {}, platform }).login, ['OTHER_KEY']);
    assert.deepEqual(childEnvOf({ host: bare, shippedHosts, env: {}, platform }).login, []);
    assert.deepEqual(childEnvOf({ host: HOOKS_ONLY_HOST, shippedHosts, env: {}, platform }).login, []);
  });

  it('adds what the running host names after the shipped names, each once: its marks and identity variables are session variables, and its marks are parked', () => {
    const { shippedHosts, platform } = quietWorld();
    assert.deepEqual(childEnvOf({ host: OTHER, shippedHosts, env: {}, platform }), {
      session: [...SHIPPED_SESSION, 'OTHER_SOCKET', 'OTHER_AGENT', 'OTHER_SESSION', 'OTHER_ROOT', 'OTHER_TAB'],
      parked: [...SHIPPED_PARKED, 'OTHER_SESSION', 'OTHER_TAB', 'OTHER_AGENT'],
      login: ['OTHER_KEY'],
    });
    assert.deepEqual(childEnvOf({ host: bare, shippedHosts: [bare], env: {}, platform }), { session: [], parked: [], login: [] });
  });

  it('ships no host whose login is not a credential variable, nor one that parks a credential', () => {
    const { shippedHosts, platform } = quietWorld();
    assert.ok(shippedHosts.length > 0);
    for (const host of shippedHosts) {
      const { login, parked } = childEnvOf({ host, shippedHosts: [], env: {}, platform });
      assert.ok(login.length > 0 && login.every((name) => CREDENTIAL_VARIABLES.includes(name)), login.join(' '));
      assert.ok(parked.every((name) => !CREDENTIAL_VARIABLES.includes(name)), parked.join(' '));
    }
  });
});

describe('sessionProcessCheckOf', () => {
  const SHIPPED_PROGRAM = { name: 'claude.exe', commandLine: '' };
  const OTHER_PROGRAM = { name: 'agent-desk', commandLine: 'agent-desk --resume' };
  const SHELL = { name: 'bash', commandLine: 'bash -l' };

  it("knows a shipped host's session process whatever host the run works in, and no other program", () => {
    const { shippedHosts, platform } = quietWorld();
    for (const [name, host] of RUNNING_HOSTS) {
      const isSessionProcess = sessionProcessCheckOf({ host, shippedHosts, env: {}, platform });
      assert.deepEqual([SHIPPED_PROGRAM, OTHER_PROGRAM, SHELL].map(isSessionProcess), [true, false, false], name);
    }
  });

  it('adds the program the running host says runs its sessions, and takes none of the shipped ones away', () => {
    const { shippedHosts, platform } = quietWorld();
    const isSessionProcess = sessionProcessCheckOf({ host: hostRunning('agent-desk'), shippedHosts, env: {}, platform });
    assert.deepEqual([SHIPPED_PROGRAM, OTHER_PROGRAM, SHELL].map(isSessionProcess), [true, true, false]);
  });

  it('knows the running host alone when no host is shipped, and no process at all where no host tells of its sessions', () => {
    const alone = sessionProcessCheckOf({ host: hostRunning('agent-desk'), shippedHosts: [], env: {}, platform: 'linux' });
    assert.deepEqual([SHIPPED_PROGRAM, OTHER_PROGRAM, SHELL].map(alone), [false, true, false]);
    const none = sessionProcessCheckOf({ host: bare, shippedHosts: [bare], env: {}, platform: 'linux' });
    assert.deepEqual([SHIPPED_PROGRAM, OTHER_PROGRAM, SHELL].map(none), [false, false, false]);
  });
});

describe('sessionCommandLinesOf', () => {
  const SHIPPED_FORK = 'claude --resume c0 --fork-session';
  const OWN_FORK = 'agent-desk --branch-from c0';
  const PLAIN = 'claude --resume c0';
  const JOB = { name: 'node', commandLine: 'node job.js' };
  const SHIPPED_JOB = [JOB, { name: 'claude', commandLine: 'claude bg-pty-host --bg-pty-host sock 80 24 --session-id c0 -- node job.js' }];
  const OWN_JOB = [JOB, { name: 'agent-desk', commandLine: 'agent-desk job-host --as c1' }];
  const OWN_JOB_HOST = 'agent-desk job-host --as ';
  /** A host reading forks and jobs by flags of its own, as no shipped adapter spells them. */
  const OWN_LINES = hostReadingLines({
    isForkOf: (commandLine, session) => commandLine === `agent-desk --branch-from ${session}`,
    backgroundJobSession: ([, starter]) => (starter?.commandLine.startsWith(OWN_JOB_HOST) === true ? starter.commandLine.slice(OWN_JOB_HOST.length) : undefined),
  });

  it("reads a shipped host's fork and background job whatever host the run works in", () => {
    const { shippedHosts, platform } = quietWorld();
    for (const [name, host] of RUNNING_HOSTS) {
      const lines = sessionCommandLinesOf({ host, shippedHosts, env: {}, platform });
      assert.deepEqual([SHIPPED_FORK, OWN_FORK, PLAIN, undefined].map((line) => lines.isForkOf(line, 'c0')), [true, false, false, false], name);
      assert.deepEqual([lines.backgroundJobSession(SHIPPED_JOB), lines.backgroundJobSession(OWN_JOB)], ['c0', undefined], name);
    }
  });

  it("adds the running host's own reading, and takes none of the shipped ones away", () => {
    const { shippedHosts, platform } = quietWorld();
    const lines = sessionCommandLinesOf({ host: OWN_LINES, shippedHosts, env: {}, platform });
    assert.deepEqual([SHIPPED_FORK, OWN_FORK, PLAIN].map((line) => lines.isForkOf(line, 'c0')), [true, true, false]);
    assert.deepEqual([lines.backgroundJobSession(SHIPPED_JOB), lines.backgroundJobSession(OWN_JOB)], ['c0', 'c1']);
  });

  it('reads no fork or job where no host tells of its sessions', () => {
    const lines = sessionCommandLinesOf({ host: bare, shippedHosts: [bare], env: {}, platform: 'linux' });
    assert.deepEqual([SHIPPED_FORK, OWN_FORK].map((line) => lines.isForkOf(line, 'c0')), [false, false]);
    assert.equal(lines.backgroundJobSession(SHIPPED_JOB), undefined);
  });
});

describe('hostHomeOf', () => {
  it("gives the host's own folder for the person of the run", () => {
    const world = quietWorld();
    assert.equal(hostHomeOf({ host: world.host, env: {}, platform: world.platform, userHome: USER_HOME }), join(USER_HOME, '.claude'));
    const moved = { CLAUDE_CONFIG_DIR: join('/', 'cfg') };
    assert.equal(hostHomeOf({ host: world.host, env: moved, platform: world.platform, userHome: USER_HOME }), join('/', 'cfg'));
  });

  it('refuses with the reason of a host whose folders are not known', () => {
    assert.throws(
      () => hostHomeOf({ host: bare, env: {}, platform: 'linux', userHome: USER_HOME }),
      (error) => error instanceof RefusedError && error.message === 'no folder of the host is known',
    );
  });
});

describe('hostHomeIfKnown', () => {
  it("gives the host's own folder for the person of the run, and nothing for a host whose folders are not known", () => {
    const world = quietWorld();
    assert.equal(hostHomeIfKnown({ host: world.host, env: {}, platform: world.platform, userHome: USER_HOME }), join(USER_HOME, '.claude'));
    assert.equal(hostHomeIfKnown({ host: bare, env: {}, platform: 'linux', userHome: USER_HOME }), undefined);
  });
});

describe('stepsOf', () => {
  it('gives the steps of the host the run is in', () => {
    const world = quietWorld();
    assert.equal(stepsOf({ host: world.host, env: {}, platform: world.platform }).exit, shippedSteps().exit);
  });

  it('refuses with the reason of a host that names no steps', () => {
    assert.throws(() => stepsOf({ host: bare, env: {}, platform: 'linux' }), (error) => error instanceof RefusedError && error.message === 'no steps are known');
  });
});

describe('hostNameOf', () => {
  it('gives the name of the host the run is in', () => {
    const world = quietWorld();
    assert.equal(hostNameOf({ host: world.host, env: {}, platform: world.platform }), 'Claude Code');
  });

  it('refuses with the reason of a host that does not say who it is', () => {
    assert.throws(() => hostNameOf({ host: bare, env: {}, platform: 'linux' }), (error) => error instanceof RefusedError && error.message === 'no session of the host is told');
  });
});
