import type { TerminalChoice } from '../config/types.ts';
import type { Env } from '../core/home.ts';
import type { StartRequest } from './processes.ts';

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

export type TabCommand = { readonly kind: 'command'; readonly request: StartRequest } | { readonly kind: 'unusable'; readonly why: string };

/**
 * Windows Terminal re-reads its command line: `;` starts its next command, and it may expand `%VAR%`
 * and re-quote `"`. The kit's own arguments (ids, base64url) never hold these; a path might.
 */
const WINDOWS_TERMINAL_UNSAFE = /[;"%\p{Cc}]/u;

function command(command: string, args: readonly string[], folder: string, mode: StartRequest['mode']): TabCommand {
  return { kind: 'command', request: { command, args, cwd: folder, mode } };
}

/** The first argument Windows Terminal would misread, if any. */
function windowsTerminalUnsafe(tab: TabRequest): string | undefined {
  const { title, folder, window, argv } = tab;
  return [title, folder, ...(window === undefined ? [] : [window]), ...argv].find((arg) => WINDOWS_TERMINAL_UNSAFE.test(arg));
}

function windowsTerminalRefusal(unsafe: string): TabCommand {
  return { kind: 'unusable', why: `Windows Terminal would misread ${JSON.stringify(unsafe)} (it holds ; " % or a control character)` };
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

/**
 * The launcher call that splits the run's own terminal window and runs `argv` in the new pane, side by side (T5105).
 * tmux splits the pane the run works in (it names it in `TMUX_PANE`), and `-d` keeps the focus there; Windows
 * Terminal splits the active pane of its most recent window, the one the person is typing in, and `tab.window` is not
 * read: a split is of the window the run is in.
 */
export function splitCommand(terminal: SplitTerminal, tab: TabRequest): TabCommand {
  const { title, folder, argv, focus } = tab;
  switch (terminal) {
    case 'tmux':
      return command('tmux', ['split-window', '-h', ...(focus === 'keep' ? ['-d'] : []), '-c', folder, ...argv], folder, 'exit');
    case 'windows-terminal': {
      const unsafe = windowsTerminalUnsafe({ ...tab, window: undefined });
      if (unsafe !== undefined) {
        return windowsTerminalRefusal(unsafe);
      }
      return command('wt.exe', ['-w', '0', 'split-pane', '--vertical', '--title', title, '-d', folder, '--', ...argv], folder, 'exit');
    }
  }
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

