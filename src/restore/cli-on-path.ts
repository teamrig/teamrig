import { chmod } from 'node:fs/promises';
import type { Files } from '../core/files.ts';
import { cliLauncherFolder, cliLaunchers, shShimPath } from './cli-launcher.ts';
import { launcherStep, type MachineStep } from './install-plan.ts';
import type { UserPath } from './user-path.ts';

/** Marks a file one the system may run as a program; a no-op where no such mark exists (Windows). */
export type MarkExecutable = (path: string) => Promise<void>;

/** The real marker: the owner reads, writes and runs it, others read and run it (0755); nothing on Windows, which has no such mark. */
export function nodeMarkExecutable(platform: NodeJS.Platform): MarkExecutable {
  return platform === 'win32' ? async () => undefined : (path) => chmod(path, 0o755);
}

/** What puts `teamrig` on the user's PATH. */
export interface CliOnPath {
  readonly files: Files;
  readonly kitHome: string;
  /** The running client's kit launcher text, which `teamrig.mjs` is kept equal to (cli-launcher.ts KIT_LAUNCHER_FILE). */
  readonly launcherText: string;
  readonly platform: NodeJS.Platform;
  readonly userPath: UserPath;
  readonly markExecutable: MarkExecutable;
}

/** `step`, which writes `path`, then marks `path` a program. */
function markedStep(step: MachineStep, path: string, markExecutable: MarkExecutable): MachineStep {
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
export function cliOnPathNote(folder: string, where: string): string {
  return `teamrig: this start added ${folder} to your user PATH (${where}), so terminals opened from now on run teamrig; a team turns this off with cliOnPath.enabled false`;
}

/**
 * The steps that make `teamrig` run from any terminal: write each launcher missing or out of date in the kit home's
 * bin folder (cli-launcher.ts), the sh shim marked a program, then add that folder to the user's PATH when it lacks
 * it, last, so the PATH never names a folder with no launcher in it. None when all are in place. Terminals open
 * already keep their PATH: only ones opened after the step find `teamrig`.
 */
export async function cliOnPathSteps(cli: CliOnPath): Promise<MachineStep[]> {
  const { files, kitHome, launcherText, platform, userPath, markExecutable } = cli;
  const shim = shShimPath(kitHome);
  const perLauncher = await Promise.all(
    cliLaunchers(kitHome, platform, launcherText).map(async (launcher) => {
      const written = await launcherStep(files, launcher, 'refresh');
      return launcher.path === shim ? written.map((step) => markedStep(step, shim, markExecutable)) : written;
    }),
  );
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
