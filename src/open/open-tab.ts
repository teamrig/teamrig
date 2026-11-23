import { randomBytes } from 'node:crypto';
import { terminalPortOf } from '../composition/terminal-ports.ts';
import type { ModuleImporter } from '../composition/loader.ts';
import type { TerminalChoice } from '../config/types.ts';
import type { Env } from '../core/home.ts';
import type { Processes } from './processes.ts';
import { autoTerminals, splitCommand, splittableTerminal, type SplitTerminal, type TabRequest, type Terminal } from './terminals.ts';

/** A tab opened in `terminal`, with the terminal's own id of it, or none, with why each terminal tried could not open it. */
export type OpenOutcome = { readonly kind: 'opened'; readonly terminal: Terminal; readonly pane: string } | { readonly kind: 'none'; readonly reasons: readonly string[] };

/** A split of the run's own window opened in `terminal`, or none, with why. */
export type SplitOutcome = { readonly kind: 'opened'; readonly terminal: SplitTerminal } | { readonly kind: 'none'; readonly reasons: readonly string[] };

/** An opened tab in words for a log: `windows-terminal opened it`. A port answers no more of the launch than that it opened. */
export function openedWords(outcome: Extract<OpenOutcome, { kind: 'opened' }>): string {
  return `${outcome.terminal} opened it`;
}

export interface OpenTabDeps {
  readonly processes: Processes;
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  /** The folder a program a terminal runs starts in, where the request names no tab's own. */
  readonly cwd: string;
  /** Loads the terminal adapters; the real import unless a spec serves its own. */
  readonly importer?: ModuleImporter;
}

/** The terminals a choice tries, in order: the one chosen, those `auto` finds, or none for `print`. */
export function candidatesOf(choice: TerminalChoice, deps: Pick<OpenTabDeps, 'env' | 'platform'>): readonly Terminal[] {
  switch (choice) {
    case 'auto':
      return autoTerminals(deps.env, deps.platform);
    case 'print':
      return [];
    default:
      return [choice];
  }
}

/** The token a new pane's wakes must carry: 32 random bytes, so no other pane's token and no guess allows a wake of it. */
export function mintWakeToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Opens the tab in the chosen terminal, or the first `auto` finds that opens it; `print` tries none. */
export async function openTab(deps: OpenTabDeps, choice: TerminalChoice, tab: TabRequest): Promise<OpenOutcome> {
  const reasons: string[] = [];
  const terminalDeps = { env: deps.env, platform: deps.platform, processes: deps.processes, cwd: deps.cwd };
  for (const terminal of candidatesOf(choice, deps)) {
    const reach = await terminalPortOf(terminal, terminalDeps, deps.importer);
    if (reach.kind === 'refused') {
      reasons.push(`${terminal}: ${reach.why}`);
      continue;
    }
    const answer = await reach.port.open({ ...tab, identity: {}, wakeToken: mintWakeToken() });
    switch (answer.kind) {
      case 'opened':
        return { kind: 'opened', terminal, pane: answer.pane };
      case 'unserved':
        reasons.push(`${terminal} opens no tab`);
        break;
      case 'failed':
        reasons.push(`${terminal}: ${answer.why}`);
        break;
    }
  }
  return { kind: 'none', reasons: reasons.length === 0 ? ['the terminal setting is print'] : reasons };
}

/**
 * Splits the terminal window this run works in and runs the tab's command in the new pane (T5105): only tmux and
 * Windows Terminal split, found by their own variables (`splittableTerminal`), whatever `open.terminal` says, as the
 * split is of the run's own window. It starts the split's launcher itself, as the terminal port has no split yet;
 * the focus stays by the launcher's own flag, so no window is raised over the person's.
 */
export async function openSplit(deps: OpenTabDeps, tab: TabRequest): Promise<SplitOutcome> {
  const terminal = splittableTerminal(deps.env);
  if (terminal === undefined) {
    return { kind: 'none', reasons: ['this terminal is neither tmux nor Windows Terminal, the ones that split'] };
  }
  const planned = splitCommand(terminal, tab);
  if (planned.kind === 'unusable') {
    return { kind: 'none', reasons: [planned.why] };
  }
  const outcome = await deps.processes.start(planned.request);
  switch (outcome.kind) {
    case 'started':
      return { kind: 'opened', terminal };
    case 'missing':
      return { kind: 'none', reasons: [`${terminal} is not installed`] };
    case 'failed':
      return { kind: 'none', reasons: [`${terminal} failed: ${outcome.error}`] };
  }
}
