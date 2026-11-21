import type { HostSteps } from '../../../plugin-api/index.ts';

/** Claude Code's program, as a terminal runs it. */
const PROGRAM = 'claude';

/** Claude Code's slash commands and its `claude` program's commands. */
export const hostSteps: HostSteps = {
  reloadPlugins: '/reload-plugins',
  exit: '/exit',
  pluginCommand: (name) => `/${name}`,
  resume: (id) => `${PROGRAM} --resume ${id}`,
  updatePlugin: (plugin, marketplace) => `${PROGRAM} plugin update ${plugin}@${marketplace}`,
  updateHost: `${PROGRAM} update`,
};
