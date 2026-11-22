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
 * The `teamrig` a shell runs is this install's: its shim on PATH sits in the bin folder of the plugin this CLI runs
 * from. Another install's shim there is an older or newer teamrig answering every command typed, as after an update
 * in a session that started before it.
 */
export const CLI_STEP: InstallStep<CoreStepDeps> = {
  id: 'cli',
  addedIn: INSTALL_CHECK_BASELINE,
  title: `the ${KIT_NAME} command on PATH`,
  async probe(deps) {
    const plugin = pluginFolderOf(deps.script, 2, deps.platform);
    const bin = pathsOf(deps.platform).join(plugin, 'bin');
    const shim = await findProgram(KIT_NAME, deps, WINDOWS_COMMAND_EXTENSIONS);
    if (shim === undefined) {
      return { kind: 'missing', detail: `no ${KIT_NAME} on PATH`, fix: `start a new session of a host with the ${KIT_NAME} plugin enabled, or add ${bin} to PATH` };
    }
    if (!sameFolder(pluginFolderOf(shim, 1, deps.platform), plugin, deps.platform)) {
      return {
        kind: 'missing',
        detail: `the ${KIT_NAME} on PATH (${shim}) is another install than this one (${deps.script})`,
        fix: `start a new session so PATH names the installed plugin's bin folder, or put ${bin} first on PATH`,
      };
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
