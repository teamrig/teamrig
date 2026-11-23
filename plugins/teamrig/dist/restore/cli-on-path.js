import { chmod } from 'node:fs/promises';
import { cliLauncherFolder, cliLaunchers, shShimPath } from "./cli-launcher.js";
import { launcherStep } from "./install-plan.js";
/** The real marker: the owner reads, writes and runs it, others read and run it (0755); nothing on Windows, which has no such mark. */
export function nodeMarkExecutable(platform) {
    return platform === 'win32' ? async () => undefined : (path) => chmod(path, 0o755);
}
/** `step`, which writes `path`, then marks `path` a program. */
function markedStep(step, path, markExecutable) {
    return {
        line: step.line,
        act: async () => {
            await step.act();
            await markExecutable(path);
        },
    };
}
/**
 * What the session start that added `folder` to the user's PATH (kept in `where`) tells the person and the model once:
 * a terminal open already keeps its PATH, and the key that turns the step off.
 */
export function cliOnPathNote(folder, where) {
    return `teamrig: this start added ${folder} to your user PATH (${where}), so terminals opened from now on run teamrig; a team turns this off with cliOnPath.enabled false`;
}
/**
 * The steps that make `teamrig` run from any terminal: write each launcher missing or out of date in the kit home's
 * bin folder (cli-launcher.ts), the sh shim marked a program, then add that folder to the user's PATH when it lacks
 * it, last, so the PATH never names a folder with no launcher in it. None when all are in place. Terminals open
 * already keep their PATH: only ones opened after the step find `teamrig`.
 */
export async function cliOnPathSteps(cli) {
    const { files, kitHome, platform, userPath, markExecutable } = cli;
    const shim = shShimPath(kitHome);
    const perLauncher = await Promise.all(cliLaunchers(kitHome, platform).map(async (launcher) => {
        const written = await launcherStep(files, launcher, 'refresh');
        return launcher.path === shim ? written.map((step) => markedStep(step, shim, markExecutable)) : written;
    }));
    const steps = perLauncher.flat();
    const folder = cliLauncherFolder(kitHome);
    if (!(await userPath.holds(folder))) {
        steps.push({
            line: `ADD ${folder} to the user's PATH (${userPath.where}), so terminals opened from now on run teamrig`,
            act: () => userPath.add(folder),
        });
    }
    return steps;
}
