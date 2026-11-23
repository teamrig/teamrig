import type { TerminalChoice } from '../config/types.ts';
import type { Env } from '../core/home.ts';
import { startKeepingFocus } from './keep-focus.ts';
import { EXIT_WAIT_MS, type LaunchEnd, type Processes } from './processes.ts';
import { autoTerminals, splitCommand, splittableTerminal, tabCommand, type TabCommand, type TabRequest, type Terminal } from './terminals.ts';

/** A tab opened in `terminal`, and how its launcher ended, or none, with why each terminal tried could not open it. */
export type OpenOutcome =
  | { readonly kind: 'opened'; readonly terminal: Terminal; readonly end: LaunchEnd }
  | { readonly kind: 'none'; readonly reasons: readonly string[] };

/** How an opened tab's launch ended, for a log: `windows-terminal exited 0`. */
export function launchWords(terminal: Terminal, end: LaunchEnd): string {
  switch (end) {
    case 'exited':
      return `${terminal} exited 0`;
    case 'running':
      return `${terminal} still running after ${EXIT_WAIT_MS / 1_000} s`;
    case 'spawned':
      return `${terminal} started`;
  }
}

export interface OpenTabDeps {
  readonly processes: Processes;
  readonly env: Env;
  readonly platform: NodeJS.Platform;
}

/** The terminals a choice tries, in order: the one chosen, those `auto` finds, or none for `print`. */
export function candidatesOf(choice: TerminalChoice, deps: OpenTabDeps): readonly Terminal[] {
  switch (choice) {
    case 'auto':
      return autoTerminals(deps.env, deps.platform);
    case 'print':
      return [];
    default:
      return [choice];
  }
}

/** Opens the tab in the chosen terminal, or the first `auto` finds that works; `print` tries none. */
export async function openTab(deps: OpenTabDeps, choice: TerminalChoice, tab: TabRequest): Promise<OpenOutcome> {
  return openFirst(deps, tab, { candidates: candidatesOf(choice, deps), plan: tabCommand, none: 'the terminal setting is print', raisesWindow: true });
}

/**
 * Splits the terminal window this run works in and runs the tab's command in the new pane (T5105): only tmux and
 * Windows Terminal split, found by their own variables (`splittableTerminal`), whatever `open.terminal` says, as the
 * split is of the run's own window.
 */
export async function openSplit(deps: OpenTabDeps, tab: TabRequest): Promise<OpenOutcome> {
  const terminal = splittableTerminal(deps.env);
  return openFirst(deps, tab, {
    candidates: terminal === undefined ? [] : [terminal],
    plan: splitCommand,
    none: 'this terminal is neither tmux nor Windows Terminal, the ones that split',
    raisesWindow: false,
  });
}

/** Where a tab may open and how: the terminals tried in order, the launcher call for each, and why none, when none is tried. */
interface Placement<T extends Terminal> {
  readonly candidates: readonly T[];
  readonly plan: (terminal: T, tab: TabRequest) => TabCommand;
  readonly none: string;
  /** Whether the launch may raise another window over the one the person is in: a new tab may, a split of their own window cannot. */
  readonly raisesWindow: boolean;
}

/** Starts the first candidate's launcher call that works, else says why each failed, or the placement's `none` when it tried none. */
async function openFirst<T extends Terminal>(deps: OpenTabDeps, tab: TabRequest, placement: Placement<T>): Promise<OpenOutcome> {
  const reasons: string[] = [];
  for (const terminal of placement.candidates) {
    const planned = placement.plan(terminal, tab);
    if (planned.kind === 'unusable') {
      reasons.push(planned.why);
      continue;
    }
    // tmux and macOS Terminal keep the focus by their own flags (tabCommand); Windows Terminal has none.
    const outcome =
      terminal === 'windows-terminal' && tab.focus === 'keep' && placement.raisesWindow
        ? await startKeepingFocus(deps.processes, deps.env, planned.request)
        : await deps.processes.start(planned.request);
    switch (outcome.kind) {
      case 'started':
        return { kind: 'opened', terminal, end: outcome.end };
      case 'missing':
        reasons.push(`${terminal} is not installed`);
        break;
      case 'failed':
        reasons.push(`${terminal} failed: ${outcome.error}`);
        break;
    }
  }
  return { kind: 'none', reasons: reasons.length === 0 ? [placement.none] : reasons };
}
