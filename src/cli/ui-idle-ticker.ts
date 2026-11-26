import { join } from 'node:path';
import { errorMessage } from '../core/guards.ts';
import { resolveKitHome } from '../core/home.ts';
import { SessionRecordStore } from '../sessions/record.ts';
import { runTeamPassFrom, type PassDue } from './commands/hook-tree-idle-pass.ts';
import { IDLE_PASS_EVERY_MS, isPassDue, isTreePassDue } from './idle-pass-log.ts';
import type { CliRuntime, Output } from './runtime.ts';
import { loadTree, type TreeTeam } from './tree.ts';

/**
 * The idle pass as `teamrig ui` runs it (T5634): a host with no tab mod, such as Codex CLI, has no wake check
 * between turns, so while no turn ends nothing ran its team's pass. The UI process is up the whole time a person
 * works, so it runs every team's pass on a timer, beside the tabs' own wake checks, each under its own lock and minute.
 */

/** What one tick of the UI's passes did: the teams whose pass ran, and the lines it would have warned. */
export interface UiPassTick {
  readonly teams: readonly string[];
  readonly problems: readonly string[];
}

/** Runs the passes of one tick, through `runtime`, whose output the ticker keeps off the UI's terminal. */
export type UiPassRunner = (runtime: CliRuntime) => Promise<UiPassTick>;

/** Where the UI's last tick is written: one tick, overwritten each minute, so the file never grows. */
export function uiIdlePassPath(kitHome: string): string {
  return join(kitHome, 'ui', 'idle-pass.json');
}

/** Whether any session of `team` runs in a host with no tab mod to run its wake check (src/cli/hosted-wake.ts). */
async function hasHostedSession(runtime: CliRuntime, { kit, roster }: TreeTeam): Promise<boolean> {
  const records = await new SessionRecordStore(runtime.files, kit.paths).readEach(roster.ids);
  return [...records.values()].some((record) => record?.host !== undefined);
}

/**
 * When the UI runs a team's pass: each minute for a team with a session in such a host, as a tab's wake check would;
 * else only once its own tabs left it unrun for five minutes, so they keep running it in their own folders.
 */
async function dueOf(runtime: CliRuntime, team: TreeTeam): Promise<PassDue> {
  return (await hasHostedSession(runtime, team)) ? isPassDue : isTreePassDue;
}

/** One tick: the pass of every team of the kit home that is due, a team's failure warned and the others run. */
export async function runUiIdlePasses(runtime: CliRuntime): Promise<UiPassTick> {
  const { teams } = await loadTree(runtime);
  const now = runtime.clock.now();
  const ran: string[] = [];
  for (const [team, loaded] of teams) {
    try {
      if (await runTeamPassFrom(runtime, team, loaded, await dueOf(runtime, loaded), 'the UI', now)) {
        ran.push(team);
      }
    } catch (error) {
      runtime.out.stderr(`WARN the idle pass of team ${team}, run from the UI, failed: ${errorMessage(error)}; the next pass tries again`);
    }
  }
  return { teams: ran, problems: [] };
}

/** An output that keeps every line, since the UI owns the terminal; the stderr lines are a tick's problems. */
function keptOutput(problems: string[]): Output {
  return { stdout: () => undefined, stderr: (line) => problems.push(line) };
}

/** Writes the tick's outcome over the last one: when, the teams whose pass ran, and its problems. */
async function writeTick(runtime: CliRuntime, path: string, tick: UiPassTick): Promise<void> {
  const record = { v: 1, at: new Date(runtime.clock.now()).toISOString(), teams: [...tick.teams], problems: [...tick.problems] };
  await runtime.files.write(path, `${JSON.stringify(record)}\n`);
}

/** The ticker the UI runs: `stop` ends it at its next wake, and `ended` settles once the loop is out. */
export interface UiIdleTicker {
  stop(): void;
  readonly ended: Promise<void>;
}

/**
 * Starts the UI's ticker: it waits `IDLE_PASS_EVERY_MS` first, then runs a tick, and again until stopped. Its waits
 * are `idleSleep`s, which never hold the process open, so the UI ends when its program does. A tick that throws is
 * written as its problem and the loop goes on; a tick's outcome that cannot be written is let go, as the next writes again.
 */
export function startUiIdleTicker(runtime: CliRuntime, runPasses: UiPassRunner = runUiIdlePasses): UiIdleTicker {
  const path = uiIdlePassPath(resolveKitHome(runtime.env, runtime.userHome));
  let stopped = false;
  const loop = async (): Promise<void> => {
    while (!stopped) {
      await runtime.idleSleep(IDLE_PASS_EVERY_MS);
      if (stopped) {
        break;
      }
      const problems: string[] = [];
      let tick: UiPassTick;
      try {
        const done = await runPasses({ ...runtime, out: keptOutput(problems) });
        tick = { teams: done.teams, problems: [...problems, ...done.problems] };
      } catch (error) {
        tick = { teams: [], problems: [...problems, errorMessage(error)] };
      }
      await writeTick(runtime, path, tick).catch(() => undefined);
    }
  };
  return {
    stop: () => {
      stopped = true;
    },
    ended: loop(),
  };
}
