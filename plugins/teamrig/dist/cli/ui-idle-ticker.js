import { join } from 'node:path';
import { errorMessage } from "../core/guards.js";
import { resolveKitHome } from "../core/home.js";
import { SessionRecordStore } from "../sessions/record.js";
import { runTeamPassFrom } from "./commands/hook-tree-idle-pass.js";
import { IDLE_PASS_EVERY_MS, isPassDue, isTreePassDue } from "./idle-pass-log.js";
import { loadTree } from "./tree.js";
/** Where the UI's last tick is written: one tick, overwritten each minute, so the file never grows. */
export function uiIdlePassPath(kitHome) {
    return join(kitHome, 'ui', 'idle-pass.json');
}
/** Whether any session of `team` runs in a host with no tab mod to run its wake check (src/cli/hosted-wake.ts). */
async function hasHostedSession(runtime, { kit, roster }) {
    const records = await new SessionRecordStore(runtime.files, kit.paths).readEach(roster.ids);
    return [...records.values()].some((record) => record?.host !== undefined);
}
/**
 * When the UI runs a team's pass: each minute for a team with a session in such a host, as a tab's wake check would;
 * else only once its own tabs left it unrun for five minutes, so they keep running it in their own folders.
 */
async function dueOf(runtime, team) {
    return (await hasHostedSession(runtime, team)) ? isPassDue : isTreePassDue;
}
/** One tick: the pass of every team of the kit home that is due, a team's failure warned and the others run. */
export async function runUiIdlePasses(runtime) {
    const { teams } = await loadTree(runtime);
    const now = runtime.clock.now();
    const ran = [];
    for (const [team, loaded] of teams) {
        try {
            if (await runTeamPassFrom(runtime, team, loaded, await dueOf(runtime, loaded), 'the UI', now)) {
                ran.push(team);
            }
        }
        catch (error) {
            runtime.out.stderr(`WARN the idle pass of team ${team}, run from the UI, failed: ${errorMessage(error)}; the next pass tries again`);
        }
    }
    return { teams: ran, problems: [] };
}
/** An output that keeps every line, since the UI owns the terminal; the stderr lines are a tick's problems. */
function keptOutput(problems) {
    return { stdout: () => undefined, stderr: (line) => problems.push(line) };
}
/** Writes the tick's outcome over the last one: when, the teams whose pass ran, and its problems. */
async function writeTick(runtime, path, tick) {
    const record = { v: 1, at: new Date(runtime.clock.now()).toISOString(), teams: [...tick.teams], problems: [...tick.problems] };
    await runtime.files.write(path, `${JSON.stringify(record)}\n`);
}
/**
 * Starts the UI's ticker: it waits `IDLE_PASS_EVERY_MS` first, then runs a tick, and again until stopped. Its waits
 * are `idleSleep`s, which never hold the process open, so the UI ends when its program does. A tick that throws is
 * written as its problem and the loop goes on; a tick's outcome that cannot be written is let go, as the next writes again.
 */
export function startUiIdleTicker(runtime, runPasses = runUiIdlePasses) {
    const path = uiIdlePassPath(resolveKitHome(runtime.env, runtime.userHome));
    let stopped = false;
    const loop = async () => {
        while (!stopped) {
            await runtime.idleSleep(IDLE_PASS_EVERY_MS);
            if (stopped) {
                break;
            }
            const problems = [];
            let tick;
            try {
                const done = await runPasses({ ...runtime, out: keptOutput(problems) });
                tick = { teams: done.teams, problems: [...problems, ...done.problems] };
            }
            catch (error) {
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
