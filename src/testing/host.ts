import { loadHostPorts, type HostSource } from '../composition/host-ports.ts';
import type { JsonRecord } from '../core/guards.ts';
import {
  isUnsupported,
  unsupported,
  type ChildEnvironment,
  type EditedFile,
  type HookBridge,
  type HookEvent,
  type HookEventName,
  type HookReply,
  type HostPaths,
  type HostSecrets,
  type RunningProgram,
  type SessionIdentity,
  type SessionLauncher,
  type SessionVariables,
  type ShellCall,
  type TitleSwitch,
} from '../ports/host/index.ts';
import { hostDeps } from './adapter-deps.ts';
import { bareHost } from './bare-host.ts';

/**
 * The shipped host adapter, loaded once for every spec and given no program to run: a spec reads what the host
 * wrote through the code teamrig runs with, so a pin fails when that code changes.
 */
export const SHIPPED_HOST: HostSource = await loadHostPorts(hostDeps().run);

/**
 * A bare host (`bareHost`) whose hooks still run: the shipped host's hook bridge and tool calls, and no other port.
 * For a spec of what a hook does on a host lacking the rest, such as a transcript or a usage meter: on a wholly
 * bare host the hook would read no input at all.
 */
export const HOOKS_ONLY_HOST: HostSource = (given) => {
  const { hooks, toolCall } = SHIPPED_HOST(given);
  return { ...bareHost(), hooks, toolCall };
};

/**
 * A bare host (`bareHost`) whose sessions are still told: the shipped host's session launcher, and no other port.
 * For a spec of an act kept for the person on a host lacking the rest: on a wholly bare host no agent's run is told
 * from theirs, so the act is refused before it reaches what the spec is about.
 */
export const SESSIONS_ONLY_HOST: HostSource = (given) => ({ ...bareHost(), launcher: SHIPPED_HOST(given).launcher });

/**
 * The shipped host, telling none of its folders: every other port is the shipped one. For a spec of what a run does
 * with no place of the host known, while its hooks, transcript and usage are still read.
 */
export const NO_PATHS_HOST: HostSource = (given) => ({ ...SHIPPED_HOST(given), paths: unsupported('no folder of the host is known') });

/**
 * The shipped host, telling nothing of its sessions: every other port is the shipped one. For a spec of what a run
 * does when its host names no folder a session started in, whatever the environment holds.
 */
export const NO_SESSION_HOST: HostSource = (given) => ({ ...SHIPPED_HOST(given), launcher: unsupported('no session of the host is told') });

/** Who a run is when the host tells none of it: each part untold. */
export const UNTOLD_IDENTITY: SessionIdentity = { projectDir: undefined, startedAs: undefined, sessionKind: undefined, sessionId: undefined, forcedEffort: undefined };

/** The program name a test host's launcher gives, apart from the shipped host's own so a spec can tell them apart. */
export const TEST_PROGRAM = 'Test Host';

/**
 * The shipped host, saying every run is `identity` whatever the environment holds: for a spec of a reader that must
 * ask the host who the run is and read no variable of a host itself.
 */
export function hostTelling(identity: Partial<SessionIdentity>): HostSource {
  const told: SessionIdentity = { ...UNTOLD_IDENTITY, ...identity };
  return (given) => ({ ...SHIPPED_HOST(given), launcher: { ...shippedLauncher(), programName: TEST_PROGRAM, identity: () => told } });
}

/**
 * The shipped host, its sessions told by `variables` in place of its own and every run said to be `identity`, each
 * part untold unless given: for a spec of a run on a host that names marks of its own, or none. Its child
 * environment is the shipped host's unless `childEnv` names another.
 */
export function hostNaming(variables: SessionVariables, identity: Partial<SessionIdentity> = {}, childEnv: ChildEnvironment = testChildEnv()): HostSource {
  const told: SessionIdentity = { ...UNTOLD_IDENTITY, ...identity };
  return (given) => ({ ...SHIPPED_HOST(given), launcher: { ...shippedLauncher(), programName: TEST_PROGRAM, variables, childEnv, identity: () => told } });
}

/**
 * The shipped host, its sessions run by the program named `program` and no other: for a spec of a reader that must
 * ask the host which process is a session's and know no host's program itself.
 */
export function hostRunning(program: string): HostSource {
  return (given) => ({ ...SHIPPED_HOST(given), launcher: { ...shippedLauncher(), isSessionProcess: (process) => process.name === program } });
}

/**
 * The shipped host, its sessions started by the program named `program` with the arguments `launchArgs` spells, the
 * shipped host's own unless given: for a spec of a command that must ask the host what starts a session and know no
 * host's program or flag itself.
 */
export function hostStarting(program: string, launchArgs: SessionLauncher['launchArgs'] = shippedLauncher().launchArgs): HostSource {
  return (given) => ({ ...SHIPPED_HOST(given), launcher: { ...shippedLauncher(), program, launchArgs } });
}

/**
 * The shipped host, reading a session's command line with `lines` where given and its own readers elsewhere: for a
 * spec of a reader that must ask the host which process is a session's fork or background job and know no host's
 * flag itself.
 */
export function hostReadingLines(lines: Partial<Pick<SessionLauncher, 'isForkOf' | 'backgroundJobSession'>>): HostSource {
  return (given) => ({ ...SHIPPED_HOST(given), launcher: { ...shippedLauncher(), ...lines } });
}

/**
 * The shipped host, its hook port naming `titleSwitch` as what leaves the tab's title to hooks, undefined for a host
 * that writes no title of its own, and its launcher named `TEST_PROGRAM`: for a spec of a reader that must ask the
 * host which switch holds the title and know no host's variable itself.
 */
export function hostTitledBy(titleSwitch: TitleSwitch | undefined): HostSource {
  return (given) => ({ ...SHIPPED_HOST(given), hooks: { ...testHooks(given.platform), titleSwitch }, launcher: { ...shippedLauncher(), programName: TEST_PROGRAM } });
}

/** A switch named `variable` that is on at `value` alone: a test host's own, apart from any shipped host's. */
export function testTitleSwitch(variable: string, value = 'yes'): TitleSwitch {
  return { variable, value, on: (env) => env[variable] === value };
}

/** A host whose launcher names no mark of an agent's run, which no adapter that loaded does: every run there is untold. */
export const NO_MARK_HOST: HostSource = hostNaming({ marks: [], identity: [] });

/** The shipped host's session launcher in an empty environment: the names it hands a run are the same in every one. */
function shippedLauncher(): SessionLauncher {
  const { launcher } = SHIPPED_HOST({ env: {}, platform: 'linux' });
  if (isUnsupported(launcher)) throw new Error(`the shipped host tells nothing of its sessions: ${launcher.notice}`);
  return launcher;
}

/** The session variables the shipped host hands a run: the ones its declaration names. */
export function testSessionVariables(): SessionVariables {
  return shippedLauncher().variables;
}

/** The shipped host's reading of where a session ran, for a spec of a restore that must ask the host. */
export function testSessionPlace(): SessionLauncher['sessionPlaceOf'] {
  return shippedLauncher().sessionPlaceOf;
}

/** Whether a process is the shipped host's own program running a session, as its launcher port answers. */
export function testSessionProcess(process: RunningProgram): boolean {
  return shippedLauncher().isSessionProcess(process);
}

/** What the shipped host lets a program started from one of its sessions inherit of the session's variables. */
export function testChildEnv(): ChildEnvironment {
  return shippedLauncher().childEnv;
}

/** The shipped host's paths in the environment `env` on `platform`: where a spec's files are, as a run would be told them. */
export function testPaths(env: Readonly<Record<string, string | undefined>> = {}, platform: NodeJS.Platform = 'linux'): HostPaths {
  const { paths } = SHIPPED_HOST({ env, platform });
  if (isUnsupported(paths)) throw new Error(`the shipped host tells none of its folders: ${paths.notice}`);
  return paths;
}

/** The shipped host's secret files in the environment `env` on `platform`, as a run would be told them. */
export function testSecrets(env: Readonly<Record<string, string | undefined>> = {}, platform: NodeJS.Platform = 'linux'): HostSecrets {
  const { secrets } = SHIPPED_HOST({ env, platform });
  if (isUnsupported(secrets)) throw new Error(`the shipped host tells none of its secret files: ${secrets.notice}`);
  return secrets;
}

/** The shipped host's hook bridge on `platform`. */
export function testHooks(platform: NodeJS.Platform = 'linux'): HookBridge {
  const { hooks } = SHIPPED_HOST({ env: {}, platform });
  if (isUnsupported(hooks)) throw new Error(`the shipped host has no hook bridge: ${hooks.notice}`);
  return hooks;
}

/** What the shipped host reads for a hook's `reply` to the event `on`: '' when the hook has nothing to say. */
export function replyText(on: HookEventName, reply: HookReply | undefined, platform: NodeJS.Platform = 'linux'): string {
  return reply === undefined ? '' : testHooks(platform).reply(on, reply);
}

/**
 * The event the shipped host's bridge reads out of `payload`, a hook input as the host sends it: a spec keeps its
 * payload and hands the code under test what a run would.
 */
export function hookEventOf(payload: JsonRecord, platform: NodeJS.Platform = 'linux'): HookEvent {
  const event = testHooks(platform).parse(JSON.stringify(payload));
  if (event === undefined) throw new Error('the hook bridge read no event out of the payload');
  return event;
}

/**
 * The event the shipped host reads out of `payload`, its call made one edit of `files`: the shipped host's file tools
 * touch one file each, so a spec of a guard on a patch that touches several builds the call itself.
 */
export function editEventOf(payload: JsonRecord, files: readonly EditedFile[], platform: NodeJS.Platform = 'linux'): HookEvent {
  return { ...hookEventOf(payload, platform), call: { kind: 'edit', name: 'apply_patch', input: {}, files } };
}

/**
 * The shell call the shipped host reads when its tool `tool` runs `line` on `platform`: a spec's way to the texts the
 * shell may run, as a hook is handed them.
 */
export function shellCallOf(tool: string, line: string, platform: NodeJS.Platform = 'linux'): ShellCall {
  const { call } = hookEventOf({ tool_name: tool, tool_input: { command: line } }, platform);
  if (call?.kind !== 'shell') throw new Error(`the shipped host reads no shell call for the tool ${tool}`);
  return call;
}
