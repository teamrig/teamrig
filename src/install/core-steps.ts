import { posix, win32 } from 'node:path';
import type { ConfigLoad } from '../config/load.ts';
import { KIT_NAME } from '../core/home.ts';
import { findProgram, WINDOWS_COMMAND_EXTENSIONS, type PathSearchDeps } from '../core/path-search.ts';
import { MIN_NODE, versionText, type RequirementProblem, type RequirementsCheck } from '../requirements/requirements.ts';
import { INSTALL_CHECK_BASELINE, type InstallStep, type StepState } from './steps.ts';

/**
 * The install steps every host shares, in install order: Node.js, git, the teamrig CLI on PATH, then the team config.
 * The steps a host adds (its plugin enabled, its hooks firing) come from its adapter.
 */

/**
 * What a look for the team found: none (`why` is the refusal a team command gives, which names the create line), or
 * the team and how its config loaded.
 */
export type TeamLook = { readonly kind: 'none'; readonly why: string } | { readonly kind: 'found'; readonly team: string; readonly load: ConfigLoad };

/** What the shared steps read: PATH and the files on it, the requirements check, this CLI's entry script and the team. */
export interface CoreStepDeps extends PathSearchDeps {
  readonly requirements: RequirementsCheck;
  /** This CLI's entry script, `<plugin>/dist/cli/main.js` in an install. */
  readonly script: string;
  /**
   * The kit home's bin folder, `<kit home>/bin`: a session start writes the kit's own `teamrig` launcher there and puts
   * the folder on the user's PATH, so `teamrig` runs from any terminal (T5095). The launcher finds the installed
   * plugin's CLI on each run, so it is never another install.
   */
  readonly kitBin: string;
  readonly team: TeamLook;
}

/**
 * The state of `requirement` from the requirements check: unknown when its check failed, the first problem `wrong`
 * reads as a state, else ok with `ok` as the detail.
 */
async function requirementState(
  deps: CoreStepDeps,
  requirement: 'git' | 'Node.js',
  wrong: (problem: RequirementProblem) => StepState | undefined,
  ok: string,
): Promise<StepState> {
  for (const problem of await deps.requirements.problems()) {
    if (problem.kind === 'check-failed' && problem.requirement === requirement) {
      return { kind: 'unknown', why: problem.reason };
    }
    const state = wrong(problem);
    if (state !== undefined) {
      return state;
    }
  }
  return { kind: 'ok', detail: ok };
}

export const NODE_STEP: InstallStep<CoreStepDeps> = {
  id: 'node',
  addedIn: INSTALL_CHECK_BASELINE,
  title: `Node.js ${versionText(MIN_NODE)} or later`,
  probe: (deps) =>
    requirementState(
      deps,
      'Node.js',
      (problem) =>
        problem.kind === 'node-old'
          ? { kind: 'missing', detail: `Node.js ${problem.running} runs ${KIT_NAME}`, fix: `install the current Node.js LTS from nodejs.org, then start a new session` }
          : undefined,
      `Node.js ${versionText(MIN_NODE)} or later runs ${KIT_NAME}`,
    ),
};

export const GIT_STEP: InstallStep<CoreStepDeps> = {
  id: 'git',
  addedIn: INSTALL_CHECK_BASELINE,
  title: 'git on PATH',
  probe: (deps) =>
    requirementState(
      deps,
      'git',
      (problem) =>
        problem.kind === 'git-missing' ? { kind: 'missing', detail: 'no git on PATH', fix: 'install git from git-scm.com, then start a new session' } : undefined,
      'git is on PATH',
    ),
};

/** The path helpers of the platform the paths come from. */
function pathsOf(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix;
}

/** The plugin folder a CLI file sits in: `<plugin>` of `<plugin>/bin/teamrig` (1 level up) or of `<plugin>/dist/cli/main.js` (2). */
function pluginFolderOf(path: string, levels: number, platform: NodeJS.Platform): string {
  const paths = pathsOf(platform);
  let folder = paths.dirname(path);
  for (let level = 0; level < levels; level += 1) {
    folder = paths.dirname(folder);
  }
  return folder;
}

/** Whether two folders are one: Windows paths ignore case. */
function sameFolder(a: string, b: string, platform: NodeJS.Platform): boolean {
  const paths = pathsOf(platform);
  const [left, right] = [paths.resolve(a), paths.resolve(b)];
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * The fix for a `teamrig` missing from PATH or another install's: a new session, whose start puts the installed
 * plugin's bin folder on its own PATH and the kit's launcher folder on the user's. No folder to add by hand: the
 * plugin's bin folder is named by version, so the next update replaces it.
 */
const NEW_SESSION_FIX = `start a new session of a host with the ${KIT_NAME} plugin enabled`;

/**
 * Whether a session start puts the kit launcher's folder on the user's PATH: the team's `cliOnPath.enabled`, or the
 * key's default (on) where no config loaded, as a session start reads it then.
 */
function launcherGoesOnPath(team: TeamLook): boolean {
  return team.kind === 'found' && team.load.status === 'loaded' ? team.load.config.cliOnPath.enabled : true;
}

/**
 * The CLI step's fix: a new session, and with `cliOnPath.enabled` off, doctor's `cli-path` finding for a terminal of
 * the user's own, since no session start then puts the launcher on the user's PATH (T5095).
 */
function cliFix(team: TeamLook): string {
  return launcherGoesOnPath(team)
    ? NEW_SESSION_FIX
    : `${NEW_SESSION_FIX}; cliOnPath.enabled is false, so for a terminal of your own follow ${KIT_NAME} doctor's cli-path finding`;
}

/**
 * The `teamrig` a shell runs is this install's: its shim on PATH is the kit's own launcher in `kitBin`, which runs the
 * installed plugin's CLI, or sits in the bin folder of the plugin this CLI runs from. A shim anywhere else is an older
 * or newer teamrig answering every command typed, as after an update in a session that started before it.
 */
export const CLI_STEP: InstallStep<CoreStepDeps> = {
  id: 'cli',
  addedIn: INSTALL_CHECK_BASELINE,
  title: `the ${KIT_NAME} command on PATH`,
  async probe(deps) {
    const shim = await findProgram(KIT_NAME, deps, WINDOWS_COMMAND_EXTENSIONS);
    if (shim === undefined) {
      return { kind: 'missing', detail: `no ${KIT_NAME} on PATH`, fix: cliFix(deps.team) };
    }
    const folder = pathsOf(deps.platform).dirname(shim);
    if (sameFolder(folder, deps.kitBin, deps.platform)) {
      return { kind: 'ok', detail: `${shim}, the kit launcher` };
    }
    if (!sameFolder(pluginFolderOf(shim, 1, deps.platform), pluginFolderOf(deps.script, 2, deps.platform), deps.platform)) {
      return { kind: 'missing', detail: `the ${KIT_NAME} on PATH (${shim}) is another install than this one (${deps.script})`, fix: cliFix(deps.team) };
    }
    return { kind: 'ok', detail: shim };
  },
};

export const TEAM_STEP: InstallStep<CoreStepDeps> = {
  id: 'team',
  addedIn: INSTALL_CHECK_BASELINE,
  title: 'a team whose config loads',
  async probe({ team }) {
    if (team.kind === 'none') {
      return { kind: 'missing', detail: 'no team found from here', fix: team.why };
    }
    const { load } = team;
    switch (load.status) {
      case 'missing':
        return { kind: 'missing', detail: `no config at ${load.path}`, fix: `${KIT_NAME} team create ${team.team} --sessions <id,id>` };
      case 'unreadable':
        return { kind: 'missing', detail: `the config at ${load.path} cannot be read: ${load.issue.message}`, fix: `correct ${load.path}, then run ${KIT_NAME} config validate` };
      case 'loaded':
        return load.issues.length === 0
          ? { kind: 'ok', detail: `team ${team.team}, config ${load.path}` }
          : { kind: 'missing', detail: `the config at ${load.path} has ${load.issues.length} problem(s), defaults used`, fix: `${KIT_NAME} config validate` };
    }
  },
};

/** The shared steps in install order. */
export const CORE_STEPS: readonly InstallStep<CoreStepDeps>[] = [NODE_STEP, GIT_STEP, CLI_STEP, TEAM_STEP];
