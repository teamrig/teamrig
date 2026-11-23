import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { formatConfig } from '../../config/load.ts';
import { isRecord, isStringArray, recordField, stringField, type JsonRecord } from '../../core/guards.ts';
import { ENV, type Env } from '../../core/home.ts';
import type { HttpClient } from '../../core/http.ts';
import { ID_PATTERN } from '../../core/ids.ts';
import type { ProgramRunner } from '../../core/program-runner.ts';
import type { ChatWebhook } from '../../core/webhook.ts';
import type { ShellRunner } from '../../test-run/shell.ts';
import { UsageError, type ParsedArgs } from '../args.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';

const USAGE = 'usage: teamrig conformance client --script <file.json> --home <absolute path> [--steps <n>]';

/** The file in a scripted kit home that says the kit made it, from which script, and how many steps it applied. */
export const CLIENT_MARK = 'conformance-client.json';

/** The time between two steps' clocks, so a step's records are in the order the script lists them. */
export const STEP_GAP_MS = 60_000;

/** The commands a script's step may run: the writers of the register and the inbox, which a UI client reads. */
const STEP_COMMANDS: ReadonlyMap<string, number> = new Map([
  ['add', 1],
  ['set', 1],
  ['update', 1],
  ['inbox', 2],
]);

/** A step's flags that reach past the scripted home: a tracker's issue, another team, a wake. */
const OUTWARD_FLAGS = new Set(['issue', 'issue-body', 'issue-repo', 'team', 'wake', 'wake-by']);

/** A scripted team, as its file gives it. */
export interface ClientScript {
  /** The team's config, written as its `config.json`. */
  readonly team: JsonRecord;
  readonly teamId: string;
  /** The first step's clock, in milliseconds since the epoch; step `i` runs at `at + i` minutes. */
  readonly at: number;
  readonly steps: readonly (readonly string[])[];
}

/** The script a file holds, or why it is not one. */
export function scriptOf(text: string): ClientScript | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'the script is not JSON';
  }
  if (!isRecord(parsed)) {
    return 'the script is not a JSON object';
  }
  const team = recordField(parsed, 'team');
  const teamId = team === undefined ? undefined : recordField(team, 'team');
  const id = teamId === undefined ? undefined : stringField(teamId, 'id');
  if (team === undefined || id === undefined || !ID_PATTERN.test(id)) {
    return 'the script\'s "team" must be a team config whose team.id is a team id';
  }
  const atText = stringField(parsed, 'at');
  const at = atText === undefined ? Number.NaN : Date.parse(atText);
  if (Number.isNaN(at)) {
    return 'the script\'s "at" must be an ISO time, such as 2026-01-05T09:00:00Z';
  }
  const steps = parsed['steps'];
  if (!Array.isArray(steps) || !steps.every(isStringArray)) {
    return 'the script\'s "steps" must be a list of command lines, each a list of words';
  }
  for (const [index, step] of steps.entries()) {
    const why = stepProblem(step);
    if (why !== undefined) {
      return `step ${index + 1} (${step.join(' ')}): ${why}`;
    }
  }
  return { team, teamId: id, at, steps };
}

/** Why a step may not run on a scripted home; undefined when it may. */
function stepProblem(step: readonly string[]): string | undefined {
  const [first, second] = step;
  const words = first === undefined ? undefined : STEP_COMMANDS.get(first);
  if (words === undefined || (first === 'inbox' && second !== 'add')) {
    return 'a step runs only add, set, update or inbox add';
  }
  const outward = step.slice(words).find((word) => word.startsWith('--') && OUTWARD_FLAGS.has(word.slice(2).split('=')[0] ?? ''));
  return outward === undefined ? undefined : `${outward} reaches past the scripted home`;
}

interface Mark {
  readonly script: string;
  readonly applied: number;
}

function markOf(text: string | undefined): Mark | undefined {
  if (text === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) {
      return undefined;
    }
    const script = stringField(parsed, 'script');
    const applied = parsed['applied'];
    return script !== undefined && typeof applied === 'number' && Number.isInteger(applied) && applied >= 0 ? { script, applied } : undefined;
  } catch {
    return undefined;
  }
}

/** Ports a step finds shut: a scripted home reaches no network, chat, program or shell. */
function shut(what: string): Error {
  return new RefusedError(`a scripted team's step reaches no ${what}`);
}
const NO_HTTP: HttpClient = { send: async () => ({ kind: 'failed', reason: 'a scripted team reaches no network' }) };
const NO_WEBHOOK: ChatWebhook = { post: async () => 'a scripted team posts to no chat' };
const NO_PROGRAM: ProgramRunner = async () => await Promise.reject(shut('program'));
const NO_SHELL: ShellRunner = { run: async () => await Promise.reject(shut('shell')) };
export const SHUT_PORTS: Pick<CliRuntime, 'http' | 'webhook' | 'run' | 'shell'> = {
  http: NO_HTTP,
  webhook: NO_WEBHOOK,
  run: NO_PROGRAM,
  shell: NO_SHELL,
};

/**
 * `teamrig conformance client`: the kit's scripted team for a UI client's tests (docs/design/public-interface.md,
 * "The conformance kit", For tools). It writes the script's team into a private kit home at `--home` and runs its
 * steps there, the real `add`, `set`, `update` and `inbox add`, on a fixed clock and with no network, chat, program,
 * shell or wake, so a script gives the same documents on every system. The client then runs the real `read --json`
 * and `events --json` with `TEAMRIG_HOME` set to the home. `--steps <n>` stops after step n; a later run with a larger
 * n applies the rest, which a running events follower sees as a changed frame. It prints one JSON line, `home`, `team`
 * and `applied`; each step's own lines go to stderr.
 */
export async function conformanceClient(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  const scriptPath = args.flags.get('script');
  const home = args.flags.get('home');
  if (scriptPath === undefined || home === undefined || args.positionals.length > 0) {
    throw new UsageError(USAGE);
  }
  if (!isAbsolute(home)) {
    throw new UsageError(`${USAGE}\n--home must be an absolute path, not ${home}`);
  }
  const text = await runtime.files.read(scriptPath);
  if (text === undefined) {
    throw new RefusedError(`no script at ${scriptPath}`);
  }
  const script = scriptOf(text);
  if (typeof script === 'string') {
    throw new RefusedError(`${scriptPath}: ${script}`);
  }
  const wanted = stepsWanted(args.flags.get('steps'), script.steps.length);
  const sha = createHash('sha256').update(text, 'utf8').digest('hex');
  const markPath = join(home, CLIENT_MARK);
  const mark = markOf(await runtime.files.read(markPath));
  if (mark === undefined) {
    if ((await runtime.files.list(home)).length > 0) {
      throw new RefusedError(`${home} holds files the kit did not write: give an empty or missing folder`);
    }
    await runtime.files.makeFolder(join(home, 'teams', script.teamId));
    await runtime.files.write(join(home, 'teams', script.teamId, 'config.json'), formatConfig(script.team));
  } else if (mark.script !== sha) {
    throw new RefusedError(`${home} was made from another script: give an empty folder`);
  } else if (mark.applied > wanted) {
    throw new RefusedError(`${home} has ${mark.applied} steps applied, more than --steps ${wanted}: a scripted home only moves forward`);
  }
  const { runCli } = await import('../run.ts');
  let applied = mark?.applied ?? 0;
  try {
    for (; applied < wanted; applied += 1) {
      const step = script.steps[applied] ?? [];
      const code = await runCli(step, stepRuntime(runtime, clientEnv(home, script.teamId), script.at + applied * STEP_GAP_MS));
      if (code !== EXIT.ok) {
        runtime.out.stderr(`FAILED step ${applied + 1} (${step.join(' ')}) exited ${code}`);
        return EXIT.failed;
      }
    }
  } finally {
    await runtime.files.write(markPath, `${JSON.stringify({ script: sha, applied })}\n`);
  }
  runtime.out.stdout(JSON.stringify({ home, team: script.teamId, applied, env: clientEnv(home, script.teamId) }));
  return EXIT.ok;
}

/** The variables that point teamrig at the scripted team: what each step runs with, and what the client sets. */
function clientEnv(home: string, team: string): Env {
  return { [ENV.home]: home, [ENV.team]: team };
}

function stepsWanted(typed: string | undefined, count: number): number {
  if (typed === undefined) {
    return count;
  }
  const wanted = /^\d+$/.test(typed) ? Number(typed) : Number.NaN;
  if (Number.isNaN(wanted) || wanted > count) {
    throw new UsageError(`${USAGE}\n--steps takes a whole number from 0 to the script's ${count} steps`);
  }
  return wanted;
}

/** The runtime one step runs in: the scripted home only, its own clock, every outward port shut, its lines on stderr. */
function stepRuntime(runtime: CliRuntime, env: Env, at: number): CliRuntime {
  return {
    ...runtime,
    env,
    clock: { now: () => at },
    out: { stdout: (line) => runtime.out.stderr(line), stderr: (line) => runtime.out.stderr(line) },
    ...SHUT_PORTS,
  };
}
