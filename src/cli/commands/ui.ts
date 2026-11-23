import { isUiMode, UI_MODES, type KitConfig, type UiMode } from '../../config/types.ts';
import type { Env } from '../../core/home.ts';
import { ID_PATTERN, ID_RULE } from '../../core/ids.ts';
import { openSplit, openTab } from '../../open/open-tab.ts';
import type { RunOutcome } from '../../open/processes.ts';
import { RELEASED_UI } from '../../ui/pin.ts';
import { releasedEntry, type UiPin } from '../../ui/released.ts';
import { releasedEnv, uiRequest } from '../../ui/start.ts';
import { noPositionals, UsageError, type ParsedArgs } from '../args.ts';
import { resolveKitHome } from '../../core/home.ts';
import { LastTypedStore } from '../../sessions/last-typed.ts';
import { foundTeamOf, lookForTeam, openKit, requireConfig, rosterOf, sessionIdOf, type Kit } from '../kit.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';
import { homeArgs } from './open.ts';

/**
 * The kit of the team `--team` names, else of the team found here, else of the one the person last typed in: the UI
 * covers every team on the host (T5249), so a folder of no team still starts it, on the team last worked in.
 */
async function kitOf(team: string | undefined, runtime: CliRuntime): Promise<Kit> {
  if (team === undefined) {
    const found = await lookForTeam(runtime);
    if (found.kind === 'none') {
      const typed = await new LastTypedStore(runtime.files, resolveKitHome(runtime.env, runtime.userHome)).read();
      if (typed !== undefined && ID_PATTERN.test(typed.team)) {
        return openKit(runtime, typed.team);
      }
    }
    return openKit(runtime, foundTeamOf(found).team);
  }
  if (!ID_PATTERN.test(team)) {
    throw new UsageError(`--team ${team} is no team id: ${ID_RULE}`, 'ui');
  }
  return openKit(runtime, team);
}

/** The UI's entry script and the environment it runs with. */
interface UiEntry {
  readonly entry: string;
  readonly env: Env;
}

/**
 * The UI to start. `ui.path`, the owner's own build, wins and keeps the whole environment, as it is theirs. Without
 * it, the released UI `pin` names, fetched and installed under the kit home once and held to the pin at each start,
 * runs with only the variables `releasedEnv` keeps. With neither there is nothing to start.
 */
async function entryOf(config: KitConfig, runtime: CliRuntime, kit: Kit, pin: UiPin | undefined): Promise<UiEntry> {
  const { path } = config.ui;
  if (path !== undefined) {
    if ((await runtime.probe.kind(path)) !== 'file') {
      throw new RefusedError(`ui.path names ${path}, and no file is there; fix or remove ui.path in the team config`);
    }
    return { entry: path, env: runtime.env };
  }
  if (pin === undefined) {
    throw new RefusedError('no released UI is pinned in this teamrig yet; set ui.path in the team config to a UI entry script of your own build');
  }
  const deps = { files: runtime.files, http: runtime.http, nonce: () => runtime.newId() };
  const released = await releasedEntry(deps, kit.paths.kitHome, pin);
  if (!released.ok) {
    throw new RefusedError(released.reason);
  }
  return { entry: released.entry, env: releasedEnv(runtime.env) };
}

function uiExit(runtime: CliRuntime, node: string, result: RunOutcome): ExitCode {
  switch (result.kind) {
    case 'exited':
      if (result.code === 0) {
        return EXIT.ok;
      }
      runtime.out.stderr(`FAILED the UI exited with code ${result.code}`);
      return EXIT.failed;
    case 'missing':
      runtime.out.stderr(`FAILED ${node} is gone`);
      return EXIT.failed;
    case 'failed':
      runtime.out.stderr(`FAILED ${node}: ${result.error}`);
      return EXIT.failed;
  }
}

/** `--mode`, else `ui.mode`. */
function modeOf(args: ParsedArgs, config: KitConfig): UiMode {
  const named = args.flags.get('mode');
  if (named === undefined) {
    return config.ui.mode;
  }
  if (!isUiMode(named)) {
    throw new UsageError(`--mode ${named} is no UI mode: expected one of ${UI_MODES.join(', ')}`, 'ui');
  }
  return named;
}

/** The tab's title: the team when pinned, so two pinned UIs tell apart; else the UI of every team. */
function uiWindowTitle(start: UiTeam): string {
  return start.pinned ? `teamrig ui ${start.team}` : 'teamrig ui';
}

/**
 * The window the UI opens in, of its own, apart from any team's session window (`open.teamWindow`): a tab added to a
 * team's window, behind its sessions' tabs, read as no window at all (T5249). Only Windows Terminal names windows.
 */
export const UI_WINDOW = 'teamrig-ui';

/** Where the UI starts: its first team, and whether `--team` pinned it there. */
interface UiTeam {
  readonly team: string;
  readonly pinned: boolean;
}

/**
 * This same command in terminal mode, with the same kit home and session, and `--team` only when it was named, so a
 * window left unpinned still covers every team: what a window or split runs.
 */
function uiArgv(runtime: CliRuntime, start: UiTeam, session: string | undefined): string[] {
  return [
    runtime.self.node,
    runtime.self.script,
    'ui',
    '--mode',
    'terminal',
    ...(start.pinned ? ['--team', start.team] : []),
    ...homeArgs(runtime),
    ...(session === undefined ? [] : ['--session', session]),
  ];
}

/**
 * Opens a terminal window that runs this same command in terminal mode, the way `teamrig open` opens a session's tab
 * (`open.terminal`), in the window `UI_WINDOW`. True when one opened; else it says why, and `otherwise` where the UI shows.
 */
async function openUiWindow(runtime: CliRuntime, config: KitConfig, start: UiTeam, session: string | undefined, otherwise: string): Promise<boolean> {
  const tab = { title: uiWindowTitle(start), folder: runtime.cwd, argv: uiArgv(runtime, start, session), window: UI_WINDOW, focus: 'take' } as const;
  const outcome = await openTab(runtime, config.open.terminal, tab);
  if (outcome.kind === 'opened') {
    runtime.out.stdout(`OPENED the UI in a ${outcome.terminal} window`);
    return true;
  }
  runtime.out.stdout(`NOTE no terminal window opened (${outcome.reasons.join('; ')}); ${otherwise}`);
  return false;
}

/**
 * Splits the terminal window this run works in and shows the UI in the new pane, beside the session, the focus left
 * on the session's pane: terminal mode for a run with no terminal of its own to draw in, such as an AI CLI's shell
 * tool, whose host has no panel (T5105). True when one opened; else it says why.
 */
async function openUiSplit(runtime: CliRuntime, start: UiTeam, session: string | undefined): Promise<boolean> {
  const tab = { title: uiWindowTitle(start), folder: runtime.cwd, argv: uiArgv(runtime, start, session), window: undefined, focus: 'keep' } as const;
  const outcome = await openSplit(runtime, tab);
  if (outcome.kind === 'opened') {
    runtime.out.stdout(`OPENED the UI in a split of this ${outcome.terminal} window`);
    return true;
  }
  runtime.out.stdout(`NOTE no split of this terminal opened (${outcome.reasons.join('; ')})`);
  return false;
}

/**
 * Where the UI shows. A window is opened first for `window` and `both`; `window` is done once it opens. The terminal
 * half then shows here when this run has a terminal a person types in; else in a split of the session's terminal,
 * else in a window when none was tried yet, saying so; only when all of these fail does it run here anyway.
 */
async function placeUi(runtime: CliRuntime, config: KitConfig, mode: UiMode, start: UiTeam, session: string | undefined): Promise<'shown' | 'here'> {
  if (mode !== 'terminal') {
    const otherwise = runtime.interactive ? 'the UI shows in this terminal' : 'the UI shows beside the session';
    if ((await openUiWindow(runtime, config, start, session, otherwise)) && mode === 'window') {
      return 'shown';
    }
  }
  if (runtime.interactive) {
    return 'here';
  }
  if (await openUiSplit(runtime, start, session)) {
    return 'shown';
  }
  if (mode === 'terminal' && (await openUiWindow(runtime, config, start, session, 'the UI shows in this terminal'))) {
    return 'shown';
  }
  return 'here';
}

/**
 * `ui [--session <id|name>] [--team <team>] [--mode <terminal|window|both>]`: shows the dedicated UI where `--mode`,
 * else `ui.mode`, says. In this terminal, its input and output on it, it ends when the UI does; in a window, it opens
 * one running the same UI and returns; with both, it opens the window and then shows the UI here too. Run with no
 * terminal of its own (an AI CLI's shell tool), the terminal half shows in a split of the session's terminal instead
 * (`placeUi`). A window or split that cannot open falls back and says so. The UI is a program of its own that teamrig loads no code of:
 * it runs under this CLI's Node.js and is handed this CLI to call back (ui/start.ts). `pin` is the released UI it
 * starts without `ui.path`: `RELEASED_UI` in the CLI, another in a spec.
 */
export function uiCommand(pin: UiPin | undefined): (args: ParsedArgs, runtime: CliRuntime) => Promise<ExitCode> {
  return async (args, runtime) => {
    noPositionals(args);
    const kit = await kitOf(args.flags.get('team'), runtime);
    const config = requireConfig(kit, runtime, 'read');
    const mode = modeOf(args, config);
    const named = args.flags.get('session');
    const session = named === undefined ? undefined : sessionIdOf(await rosterOf(runtime, kit, config), named);
    // The entry is checked before a window opens, so a window never opens on a UI that cannot start.
    const { entry, env } = await entryOf(config, runtime, kit, pin);
    // A session named is one of this team, so it pins the team too; with neither, the UI covers every team (T5249).
    const start: UiTeam = { team: kit.paths.team, pinned: args.flags.get('team') !== undefined || session !== undefined };
    if ((await placeUi(runtime, config, mode, start, session)) === 'shown') {
      return EXIT.ok;
    }
    const { node, script } = runtime.self;
    const request = uiRequest({ entry, node, script, ...start, cwd: runtime.cwd, env, ...(session === undefined ? {} : { session }) });
    return uiExit(runtime, node, await runtime.processes.run(request));
  };
}

/** `teamrig ui`, starting the released UI this teamrig pins. */
export const ui = uiCommand(RELEASED_UI);
