import { ownContextTokensOf, sessionRefreshOf } from '../config/refresh.ts';
import type { KitConfig, RefreshConfig } from '../config/types.ts';
import { SMALLEST_MODEL_WINDOW, thousands } from './decide.ts';
import type { RefreshWindow } from './state.ts';

/**
 * A session's own refresh limit (`refresh.sessionContextTokens`, #1543) checked against its context window. teamrig
 * never guesses the window from the model's name: it takes the one the plugin's mod last reported for the session's
 * tab, kept in its state file (`RefreshWindow`), and one not reported counts as the smallest a current model has.
 */

/**
 * The share of its context window a session's own limit may reach: where the window compacts is not documented, and
 * this leaves room under it. 160k on a 200k window, under the 185k `refresh.compactCeilingTokens` holds a pending
 * compaction to; 800k on a 1M one.
 */
export const WINDOW_SHARE = 0.8;

/** The window a limit is checked against: the one reported, else the smallest of a current model. */
function countedWindow(window: number | undefined): number {
  return window ?? SMALLEST_MODEL_WINDOW;
}

/** The highest a session's own limit goes on `window` (undefined: none reported). */
export function windowCapOf(window: number | undefined): number {
  return Math.floor(countedWindow(window) * WINDOW_SHARE);
}

/**
 * The refresh settings of session `id` on the window last reported for it: its own limit capped at `windowCapOf`, so
 * it refreshes before that window compacts. The team's `contextTokens` holds as it is set, on every window.
 */
export function sessionSettingsOf(config: Pick<KitConfig, 'refresh' | 'roles'>, id: string, window: number | undefined): RefreshConfig {
  const settings = sessionRefreshOf(config, id);
  const own = ownContextTokensOf(config, id);
  return own === undefined ? settings : { ...settings, contextTokens: Math.min(own, windowCapOf(window)) };
}

/** The line that tells a session's tab its own limit is capped, and the window to record as told on. */
export interface WindowWarning {
  readonly line: string;
  readonly warned: number;
}

/**
 * The line for the turn end when session `id`'s own limit is past its window's cap, once per window: none when the
 * limit fits, the session has none, or it was told on this window already (`kept.windowWarned`). A window reported
 * later, or another one, tells it again, since the cap changes with it.
 */
export function windowWarningOf(config: Pick<KitConfig, 'refresh'>, id: string, kept: RefreshWindow, command: string): WindowWarning | undefined {
  const own = ownContextTokensOf(config, id);
  const window = countedWindow(kept.window);
  const cap = windowCapOf(kept.window);
  if (own === undefined || own <= cap || kept.windowWarned === window) {
    return undefined;
  }
  const share = `${Math.round(WINDOW_SHARE * 100)}%`;
  const of = kept.window === undefined ? `the ${thousands(window)} context window counted while none is reported` : `its ${thousands(window)} context window`;
  return {
    line: `${command}: refresh.sessionContextTokens.${id} (${thousands(own)}) is past ${share} of ${of}, so ${id} refreshes at ${thousands(cap)}`,
    warned: window,
  };
}
