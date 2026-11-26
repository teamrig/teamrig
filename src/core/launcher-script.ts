/** The kit launcher's name in the kit home's bin folder (src/restore/cli-launcher.ts cliLauncherPath). */
export const KIT_LAUNCHER_NAME = 'teamrig.mjs';

/**
 * The source of `teamrigCli()`, shared by the launchers teamrig writes to the kit home's bin folder. A launcher never
 * names a version or plugin folder, both of which change with every version, so on each run this finds the script to
 * run:
 *
 * - When the kit home names a `current` version and the kit launcher sits beside this launcher, it returns the kit
 *   launcher (src/kit/launcher.ts), on any AI CLI. That launcher checks the version's files against its integrity list
 *   before it runs a line of it, and refuses a broken install, so this never runs a version's CLI unchecked and never
 *   steps around a refusal.
 * - Else it returns the first `dist/cli/main.js` of Claude Code's plugin list that exists: a home the kit
 *   self-install (first shipped in 0.510.0) has not reached yet still runs on a Claude Code install.
 *
 * It returns undefined when neither is there. The kit home is the folder above the launcher's own bin folder. A
 * launcher that holds it imports `existsSync` and `readFileSync` from `node:fs`, `homedir` from `node:os`, `dirname`
 * and `join` from `node:path` and `fileURLToPath` from `node:url`.
 */
export const FIND_TEAMRIG_CLI = String.raw`function teamrigCli() {
  const bin = dirname(fileURLToPath(import.meta.url));
  const kitLauncher = join(bin, '${KIT_LAUNCHER_NAME}');
  if (existsSync(join(dirname(bin), 'current')) && existsSync(kitLauncher)) return kitLauncher;
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
  let list;
  try {
    list = JSON.parse(readFileSync(join(configDir, 'plugins', 'installed_plugins.json'), 'utf8'));
  } catch {
    return undefined;
  }
  for (const [key, installs] of Object.entries(list?.plugins ?? {})) {
    if (!key.startsWith('teamrig@') || !Array.isArray(installs)) continue;
    for (const install of installs) {
      if (typeof install?.installPath !== 'string') continue;
      const main = join(install.installPath, 'dist', 'cli', 'main.js');
      if (existsSync(main)) return main;
    }
  }
  return undefined;
}`;

/** What a launcher says when `teamrigCli()` finds nothing. */
export const TEAMRIG_NOT_FOUND = 'teamrig not found: the kit home names no version and no teamrig plugin is installed (run teamrig kit install)';
