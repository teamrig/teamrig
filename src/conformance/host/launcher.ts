import assert from 'node:assert/strict';
import type { HostDeps, RunningProgram, SessionIdentity, SessionLauncher, SessionStart } from '../../plugin-api/index.ts';
import { defineContract, type ContractCase, type Subject } from '../contract.ts';

type Env = HostDeps['env'];

/** What a case has the host tell a run of its session: each part as the host would set it, a part left out unset. */
export type WorldIdentity = { readonly [Part in keyof SessionIdentity]?: string };

/**
 * What the launcher sees of the host: the environment it tells a run of its session in, and the processes the
 * system shows. The world writes them in the host's own names, so a case never learns them.
 */
export interface LauncherWorld {
  /** The environment a run of a session that tells these parts gets from the host, and nothing else. */
  readonly env: (identity: WorldIdentity) => Env;
  /** A process running one of the host's sessions, as the system shows it. */
  readonly sessionProcess: RunningProgram;
}

/** The port as the core builds it: once for each run, from the environment the run got. */
export type LauncherOf = (env: Env) => SessionLauncher;

export type LauncherSubject = Subject<LauncherOf, LauncherWorld>;
export type LauncherCase = ContractCase<LauncherOf, LauncherWorld, 'host'>;

/** Every part told, each a value no liar's fixed answer holds. */
const TOLD: Required<WorldIdentity> = { projectDir: '/work/app', startedAs: 'terminal', sessionKind: 'background', sessionId: 'session-7f3a', forcedEffort: 'high' };

/** Every part of who a run is, each told alone in a case. */
const PARTS = ['projectDir', 'startedAs', 'sessionKind', 'sessionId', 'forcedEffort'] as const satisfies readonly (keyof SessionIdentity)[];

const NONE: SessionIdentity = { projectDir: undefined, startedAs: undefined, sessionKind: undefined, sessionId: undefined, forcedEffort: undefined };

/** A start that sets every part, the prompt with spaces in it. */
const FULL: SessionStart = { name: 'tr-dev', model: 'model-one', effort: 'high', resume: 'session-7f3a', settingsFile: '/home/me/settings.json', prompt: 'read your handover' };

const EMPTY: SessionStart = { name: undefined, model: undefined, effort: undefined, resume: undefined, settingsFile: undefined, prompt: undefined };

/** Processes of the system's own and of other programs, a runtime among them running a script of no host. */
const STRANGERS: readonly RunningProgram[] = [
  { name: 'explorer.exe', commandLine: 'C:\\Windows\\explorer.exe' },
  { name: 'node', commandLine: 'node /work/app/server.js' },
  { name: 'bash', commandLine: '' },
];

/** A path with either separator and no trailing one, so a host on Windows compares equal. */
function samePath(path: string | undefined): string | undefined {
  return path?.replaceAll('\\', '/').replace(/\/+$/, '');
}

function shownOf(identity: SessionIdentity): SessionIdentity {
  return { ...identity, projectDir: samePath(identity.projectDir) };
}

function assertNames(names: readonly string[], what: string): void {
  assert.ok(names.every((name) => name.trim() !== '' && !/\s/.test(name)), `${what} holds a blank name or one with a space: ${JSON.stringify(names)}`);
}

const CASES: readonly LauncherCase[] = [
  {
    id: 'launcher.names-program',
    title: 'names the program as people know it, and its file name as a shell finds it on PATH',
    features: ['sessions.open'],
    run: ({ port }) => {
      const launcher = port({});
      assert.notEqual(launcher.programName.trim(), '', 'the program has no name');
      assert.match(launcher.program, /^[A-Za-z0-9_-]+$/, 'the file name is blank or holds a folder, an extension or a space');
    },
  },
  {
    id: 'launcher.tells-identity',
    title: 'tells every part of who a run is that the host tells, a forced effort among them, and nothing it does not',
    features: ['sessions.identity'],
    run: ({ port, world }) => {
      assert.deepEqual(shownOf(port(world.env(TOLD)).identity()), TOLD);
      assert.deepEqual(port({}).identity(), NONE);
      assert.deepEqual(port(world.env({})).identity(), NONE);
      for (const part of PARTS) {
        const one: WorldIdentity = { [part]: TOLD[part] };
        assert.deepEqual(shownOf(port(world.env(one)).identity()), { ...NONE, ...one }, `told only ${part}`);
      }
    },
  },
  {
    id: 'launcher.blank-tells-nothing',
    title: 'reads a part the host set blank as none, and trims one it set with spaces',
    features: ['sessions.identity'],
    run: ({ port, world }) => {
      const blank = { projectDir: ' ', startedAs: '', sessionKind: '\t', sessionId: ' ', forcedEffort: ' ' };
      assert.deepEqual(port(world.env(blank)).identity(), NONE);
      assert.equal(port(world.env({ forcedEffort: ` ${TOLD.forcedEffort} ` })).identity().forcedEffort, TOLD.forcedEffort);
      assert.equal(port(world.env({ sessionId: ` ${TOLD.sessionId} ` })).identity().sessionId, TOLD.sessionId);
    },
  },
  {
    id: 'launcher.names-variables',
    title: 'names a mark at least, the variables it tells who a run is by, and which of them a child keeps',
    features: ['sessions.identity'],
    run: ({ port, world }) => {
      const { variables, childEnv } = port({});
      assert.ok(variables.marks.length > 0, "no variable marks an agent's run");
      assertNames([...variables.marks, ...variables.identity], 'the session variables');
      const told = Object.keys(world.env({ sessionId: TOLD.sessionId, projectDir: TOLD.projectDir }));
      assert.ok(told.length > 0 && told.every((name) => variables.identity.includes(name)), `the session's id and folder are told by ${JSON.stringify(told)}, not all named as identity`);
      assertNames([...childEnv.session, ...childEnv.login], 'the child environment');
      assert.ok(childEnv.parked.every((name) => childEnv.session.includes(name)), 'a parked variable is none the host sets for a session');
      assert.ok(childEnv.login.every((name) => !childEnv.session.includes(name)), 'a login variable is also a session one');
      assert.ok(variables.marks.every((name) => childEnv.session.includes(name)), "a child would inherit the mark of its starter's run");
    },
  },
  {
    id: 'launcher.launch-args',
    title: 'starts a session on the model, at the effort, resumed and prompted as asked, and passes nothing it was not asked',
    features: ['sessions.open', 'sessions.resume'],
    run: ({ port }) => {
      const { launchArgs } = port({});
      const full = launchArgs(FULL);
      for (const part of ['model', 'effort', 'resume'] as const) {
        assert.ok(full.includes(FULL[part] ?? ''), `the ${part} ${FULL[part]} is not one argument of ${JSON.stringify(full)}`);
      }
      assert.ok(full.includes(FULL.prompt ?? ''), 'the prompt is not handed whole, as one argument');
      const empty = launchArgs(EMPTY);
      const asked = Object.values(FULL).filter((value) => value !== undefined);
      assert.ok(empty.every((word) => !asked.includes(word)), `a start that asks nothing passes ${JSON.stringify(empty)}`);
      assert.notDeepEqual(launchArgs({ ...EMPTY, model: 'model-two' }), launchArgs({ ...EMPTY, model: FULL.model }), 'two models start alike');
    },
  },
  {
    id: 'launcher.session-process',
    title: "tells the host's own program running a session from every other process",
    features: ['sessions.process'],
    run: ({ port, world }) => {
      const launcher = port({});
      assert.ok(launcher.isSessionProcess(world.sessionProcess), `${world.sessionProcess.name} is not read as a session`);
      for (const stranger of STRANGERS) {
        assert.equal(launcher.isSessionProcess(stranger), false, `${stranger.commandLine || stranger.name} is read as a session`);
      }
    },
  },
];

/** The liars' world: each part under its own name. */
const WORLD: LauncherWorld = {
  env: (identity) => Object.fromEntries(Object.entries(identity).map(([part, value]) => [`HOST_${part.toUpperCase()}`, value])),
  sessionProcess: { name: 'host', commandLine: 'host --resume session-7f3a' },
};

const VARIABLES = { marks: [], identity: [] } as const;
const CHILD_ENV = { session: [], parked: [], login: [] } as const;

/** A liar that claims the port and does nothing: no name, no argument, no part of who a run is, no process its own. */
export function nothingLauncher(): LauncherSubject {
  return {
    world: WORLD,
    port: () => ({ programName: '', program: '', launchArgs: () => [], variables: VARIABLES, childEnv: CHILD_ENV, identity: () => NONE, isSessionProcess: () => false }),
  };
}

/** A liar that says yes to all: one fixed run whatever the host tells, one fixed start, every process its own. */
export function yesLauncher(): LauncherSubject {
  const fixed: SessionIdentity = { projectDir: '/', startedAs: 'yes', sessionKind: 'yes', sessionId: 'yes', forcedEffort: 'max' };
  return {
    world: WORLD,
    port: () => ({
      programName: 'Host',
      program: 'host',
      launchArgs: () => ['--yes'],
      variables: { marks: ['HOST'], identity: ['HOST'] },
      childEnv: { session: ['HOST'], parked: ['HOST'], login: [] },
      identity: () => fixed,
      isSessionProcess: () => true,
    }),
  };
}

/** What every host's launcher must tell of a run's session, and how it starts and finds one. */
export const LAUNCHER_CONTRACT = defineContract<LauncherOf, LauncherWorld, 'host'>({
  port: 'launcher',
  side: 'host',
  cases: CASES,
  liars: [nothingLauncher, yesLauncher],
});
