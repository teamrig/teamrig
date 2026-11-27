import type { TerminalChoice } from '../config/types.ts';
import type { Env } from '../core/home.ts';

/** A terminal `teamrig open` can start a tab in. */
export type Terminal = Exclude<TerminalChoice, 'auto' | 'print'>;

/**
 * Whether a new tab takes the focus or leaves it where it was (T2510): only a tab the human asked for takes it, so a
 * restart, reopen or hire never pulls the owner away from the tab they are reading or their meeting.
 */
export type TabFocus = 'take' | 'keep';

/** The tab to open: its title, its folder, the command it runs, as an argument list, the window it opens in and its focus. */
export interface TabRequest {
  readonly title: string;
  readonly folder: string;
  readonly argv: readonly string[];
  /** The named window the tab opens in, made when none of that name is open (`teamWindowOf`); undefined: the most recent one. Windows Terminal alone names windows; the others open as before. */
  readonly window: string | undefined;
  /** How each terminal keeps the focus is its adapter's own; the Linux terminals have no call for it. */
  readonly focus: TabFocus;
}

/** The window of a team's own its tabs open in when `open.teamWindow` is on, apart from other teams' tabs (T1427). */
export function teamWindowOf(teamWindow: boolean, team: string): string | undefined {
  return teamWindow ? `teamrig-${team}` : undefined;
}

/** The terminals whose window can split to show a pane beside the one a run works in. */
export type SplitTerminal = Extract<Terminal, 'tmux' | 'windows-terminal'>;

/**
 * The terminal this run works in, found by the variables each sets in its panes, when it is one that can split:
 * tmux first, as it may run inside Windows Terminal and its pane is the nearer one. Other terminals have no split a
 * launcher can ask for.
 */
export function splittableTerminal(env: Env): SplitTerminal | undefined {
  if ((env['TMUX'] ?? '') !== '') {
    return 'tmux';
  }
  return (env['WT_SESSION'] ?? '') === '' ? undefined : 'windows-terminal';
}

/** The terminals `auto` tries, in order: tmux inside tmux, then the platform's own. */
export function autoTerminals(env: Env, platform: NodeJS.Platform): Terminal[] {
  const inTmux: Terminal[] = (env['TMUX'] ?? '') === '' ? [] : ['tmux'];
  switch (platform) {
    case 'win32':
      return [...inTmux, 'windows-terminal'];
    case 'darwin':
      return [...inTmux, 'macos-terminal'];
    default:
      return [...inTmux, 'gnome-terminal', 'konsole', 'x-terminal-emulator'];
  }
}

