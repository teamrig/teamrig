import type { TitleSwitch } from '../../../plugin-api/index.ts';

const VARIABLE = 'CLAUDE_CODE_DISABLE_TERMINAL_TITLE';

/** The values Claude Code reads as on for a switch such as `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`. */
const ON_VALUES: ReadonlySet<string> = new Set(['1', 'true', 'yes', 'on']);

/**
 * Claude Code's switch that stops it writing the tab's title of its own. It sits in Claude Code's settings `env` or
 * the environment a session starts in, and it takes the title from tabs of projects outside teamrig too.
 */
export const TITLE_SWITCH: TitleSwitch = {
  variable: VARIABLE,
  value: '1',
  on: (env) => ON_VALUES.has(env[VARIABLE]?.trim().toLowerCase() ?? ''),
};
