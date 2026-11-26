import { join } from 'node:path';
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
import { startUiIdleTicker, type UiIdleTicker } from '../ui-idle-ticker.ts';
import { homeArgs, homeRuntimeOf } from './open.ts';

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
 * How long a run that opened a window or split waits for the UI in it to mark itself started (`markUiStarted`): a
 * terminal can take the tab and still run nothing in it, which read as a window opened (T5261). Windows Terminal and
 * Node.js together start within a few seconds on a loaded host; past this the run says no UI came up.
 */
export const UI_START_WAIT_MS = 20_000;
const UI_START_POLL_MS = 250;

/** The file a UI run here writes as it starts the UI, read by the run that opened its window or split. */
export function uiStartedPath(kitHome: string): string {
  return join(kitHome, 'ui', 'started.json');
}

/** The started mark: when a UI run here started its UI. */
interface UiStartedMark {
  readonly v: 1;
  readonly at: string;
}

function isUiStartedMark(value: unknown): value is UiStartedMark {
  return typeof value === 'object' && value !== null && 'v' in value && value.v === 1 && 'at' in value && typeof value.at === 'string';
}

/** Marks the UI run here started, so a run that opened this window or split can tell it came up. */
async function markUiStarted(runtime: CliRuntime, kitHome: string): Promise<void> {
  const mark: UiStartedMark = { v: 1, at: new Date(runtime.clock.now()).toISOString() };
  await runtime.files.write(uiStartedPath(kitHome), `${JSON.stringify(mark)}\n`);
}

/** When the UI last marked itself started, in epoch milliseconds; undefined with no mark or an unreadable one. */
async function startedAt(runtime: CliRuntime, kitHome: string): Promise<number | undefined> {
  const text = await runtime.files.read(uiStartedPath(kitHome));
  if (text === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isUiStartedMark(parsed) ? Date.parse(parsed.at) : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a UI marked itself started since `since`, looked for until `UI_START_WAIT_MS` has passed. */
async function uiStartedSince(runtime: CliRuntime, kitHome: string, since: number): Promise<boolean> {
  const deadline = since + UI_START_WAIT_MS;
  for (;;) {
    const at = await startedAt(runtime, kitHome);
    if (at !== undefined && at >= since) {
      return true;
    }
    if (runtime.clock.now() >= deadline) {
      return false;
    }
    await runtime.sleep(UI_START_POLL_MS);
  }
}

/**
 * How a window or split went: `opened` once the UI in it marked itself started; `none` when none opened, which the
 * caller falls back from; `silent` when one opened but no UI started in it, which ends the run as failed rather than
 * start a second UI beside one that may still come up.
 */
type Placed = 'opened' | 'none' | 'silent';

/** OPENED once the UI in `where` started; else a FAILED line saying what to run to see why. */
async function confirmStarted(runtime: CliRuntime, kitHome: string, since: number, where: string): Promise<Placed> {
  if (await uiStartedSince(runtime, kitHome, since)) {
    runtime.out.stdout(`OPENED the UI in ${where}`);
    return 'opened';
  }
  const seconds = UI_START_WAIT_MS / 1000;
  runtime.out.stderr(`FAILED ${where} opened, but no UI started in it within ${seconds} s; run teamrig ui --mode terminal in a terminal to see why`);
  return 'silent';
}

/**
 * Opens a terminal window that runs this same command in terminal mode, the way `teamrig open` opens a session's tab
 * (`open.terminal`), in the window `UI_WINDOW`, and waits for its UI to start; when none opens it says why, and
 * `otherwise` where the UI shows.
 */
async function openUiWindow(runtime: CliRuntime, config: KitConfig, kit: Kit, start: UiTeam, session: string | undefined, otherwise: string): Promise<Placed> {
  const tab = { title: uiWindowTitle(start), folder: runtime.cwd, argv: uiArgv(runtime, start, session), window: UI_WINDOW, focus: 'take' } as const;
  const since = runtime.clock.now();
  const outcome = await openTab(runtime, config.open.terminal, tab);
  if (outcome.kind === 'opened') {
    return confirmStarted(runtime, kit.paths.kitHome, since, `a ${outcome.terminal} window`);
  }
  runtime.out.stdout(`NOTE no terminal window opened (${outcome.reasons.join('; ')}); ${otherwise}`);
  return 'none';
}

/**
 * Splits the terminal window this run works in and shows the UI in the new pane, beside the session, the focus left
 * on the session's pane: terminal mode for a run with no terminal of its own to draw in, such as an AI CLI's shell
 * tool, whose host has no panel (T5105). It waits for the UI to start there; when no split opens it says why.
 */
async function openUiSplit(runtime: CliRuntime, kit: Kit, start: UiTeam, session: string | undefined): Promise<Placed> {
  const tab = { title: uiWindowTitle(start), folder: runtime.cwd, argv: uiArgv(runtime, start, session), window: undefined, focus: 'keep' } as const;
  const since = runtime.clock.now();
  const outcome = await openSplit(runtime, tab);
  if (outcome.kind === 'opened') {
    return confirmStarted(runtime, kit.paths.kitHome, since, `a split of this ${outcome.terminal} window`);
  }
  runtime.out.stdout(`NOTE no split of this terminal opened (${outcome.reasons.join('; ')})`);
  return 'none';
}

/**
 * Where the UI shows. A window is opened first for `window` and `both`; `window` is done once its UI starts. The
 * terminal half then shows here when this run has a terminal a person types in; else in a split of the session's
 * terminal, else in a window when none was tried yet, saying so; only when none of these opens does it run here
 * anyway. A window or split that opened with no UI starting in it ends the run as `failed`.
 */
async function placeUi(runtime: CliRuntime, config: KitConfig, kit: Kit, mode: UiMode, start: UiTeam, session: string | undefined): Promise<'shown' | 'here' | 'failed'> {
  if (mode !== 'terminal') {
    const otherwise = runtime.interactive ? 'the UI shows in this terminal' : 'the UI shows beside the session';
    const window = await openUiWindow(runtime, config, kit, start, session, otherwise);
    if (window === 'silent') {
      return 'failed';
    }
    if (window === 'opened' && mode === 'window') {
      return 'shown';
    }
  }
  if (runtime.interactive) {
    return 'here';
  }
  const split = await openUiSplit(runtime, kit, start, session);
  if (split !== 'none') {
    return split === 'opened' ? 'shown' : 'failed';
  }
  if (mode === 'terminal') {
    const window = await openUiWindow(runtime, config, kit, start, session, 'the UI shows in this terminal');
    if (window !== 'none') {
      return window === 'opened' ? 'shown' : 'failed';
    }
  }
  return 'here';
}

/**
 * `ui [--session <id|name>] [--team <team>] [--mode <terminal|window|both>] [--home <dir>]`: shows the dedicated UI where `--mode`,
 * else `ui.mode`, says. In this terminal, its input and output on it, it ends when the UI does; in a window, it opens
 * one running the same UI and returns; with both, it opens the window and then shows the UI here too. Run with no
 * terminal of its own (an AI CLI's shell tool), the terminal half shows in a split of the session's terminal instead
 * (`placeUi`). A window or split that cannot open falls back and says so. The UI is a program of its own that teamrig loads no code of:
 * it runs under this CLI's Node.js and is handed this CLI to call back (ui/start.ts). `pin` is the released UI it
 * starts without `ui.path`: `RELEASED_UI` in the CLI, another in a spec. While the UI runs here, `startTicker` runs
 * the teams' idle passes beside it (ui-idle-ticker.ts).
 */
export function uiCommand(pin: UiPin | undefined, startTicker: (runtime: CliRuntime) => UiIdleTicker = startUiIdleTicker): (args: ParsedArgs, runtime: CliRuntime) => Promise<ExitCode> {
  return async (args, hostRuntime) => {
    noPositionals(args);
    // The window or split this command opens hands its kit home on as --home (homeArgs), as its own environment may not carry it.
    const runtime = homeRuntimeOf(args, hostRuntime);
    const kit = await kitOf(args.flags.get('team'), runtime);
    const config = requireConfig(kit, runtime, 'read');
    const mode = modeOf(args, config);
    const named = args.flags.get('session');
    const session = named === undefined ? undefined : sessionIdOf(await rosterOf(runtime, kit, config), named);
    // The entry is checked before a window opens, so a window never opens on a UI that cannot start.
    const { entry, env } = await entryOf(config, runtime, kit, pin);
    // A session named is one of this team, so it pins the team too; with neither, the UI covers every team (T5249).
    const start: UiTeam = { team: kit.paths.team, pinned: args.flags.get('team') !== undefined || session !== undefined };
    const placed = await placeUi(runtime, config, kit, mode, start, session);
    if (placed !== 'here') {
      return placed === 'shown' ? EXIT.ok : EXIT.failed;
    }
    const { node, script } = runtime.self;
    const request = uiRequest({ entry, node, script, ...start, cwd: runtime.cwd, env, ...(session === undefined ? {} : { session }) });
    await markUiStarted(runtime, kit.paths.kitHome);
    // While it is up, the UI runs the teams' idle passes, for a host with no wake check between turns (T5634).
    const ticker = startTicker(runtime);
    try {
      return uiExit(runtime, node, await runtime.processes.run(request));
    } finally {
      ticker.stop();
    }
  };
}

/** `teamrig ui`, starting the released UI this teamrig pins. */
export const ui = uiCommand(RELEASED_UI);
