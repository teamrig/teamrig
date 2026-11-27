import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT_LAUNCHER_NAME } from '../core/launcher-script.ts';

/** What a launcher test's kit home and Claude Code config folder hold. */
export interface KitFixture {
  /** The text of `<kit home>/current`; no file when undefined. */
  readonly current?: string;
  /** Writes a stand-in kit launcher, `<kit home>/bin/teamrig.mjs`, of `cliText`. */
  readonly kitLauncher?: boolean;
  /** The plugin folders Claude Code's plugin list names under `teamrig@market`, in order; each gets `pluginText`. */
  readonly installs?: readonly string[];
  /** Plugin folders listed with no CLI in them. */
  readonly empty?: readonly string[];
  /** Another plugin whose name starts with the same word, listed first: it must not be taken for teamrig. */
  readonly lookalike?: boolean;
  /** The stand-in CLI's text, for the kit launcher and the plugins; the test's default when undefined. */
  readonly cliText?: string;
  /** The plugins' CLI text when it must differ from the kit launcher's; `cliText` when undefined. */
  readonly pluginText?: string;
}

/** Where a fixture was written: the kit home, and the config folder for CLAUDE_CONFIG_DIR. */
export interface KitScene {
  readonly kitHome: string;
  readonly configDir: string;
}

/**
 * Writes the fixture under `root`: the kit home `kitName` with its `current` and stand-in kit launcher, and a Claude
 * Code config folder whose plugin list names the fixture's plugins, each with a `dist/cli/main.js` and the module
 * package.json a real plugin folder has. `defaultCli` is the CLI text when the fixture names none.
 */
export function writeKit(root: string, fixture: KitFixture, defaultCli: string, kitName = 'kit'): KitScene {
  const kitHome = join(root, kitName);
  const configDir = join(root, 'claude');
  const cliText = fixture.cliText ?? defaultCli;
  mkdirSync(join(kitHome, 'bin'), { recursive: true });
  if (fixture.current !== undefined) writeFileSync(join(kitHome, 'current'), fixture.current);
  if (fixture.kitLauncher === true) writeFileSync(join(kitHome, 'bin', KIT_LAUNCHER_NAME), cliText);
  const plugin = (name: string, text: string): string => {
    const folder = join(root, name);
    mkdirSync(join(folder, 'dist', 'cli'), { recursive: true });
    writeFileSync(join(folder, 'package.json'), '{ "type": "module" }');
    writeFileSync(join(folder, 'dist', 'cli', 'main.js'), text);
    return folder;
  };
  const plugins: Record<string, unknown> = {};
  if (fixture.lookalike === true) plugins['teamrig-pane@market'] = [{ installPath: plugin('pane', "process.stdout.write('pane');\n") }];
  plugins['teamrig@market'] = (fixture.installs ?? []).map((name) => ({
    installPath: fixture.empty?.includes(name) === true ? join(root, name) : plugin(name, fixture.pluginText ?? cliText),
  }));
  if (fixture.installs !== undefined || fixture.lookalike === true) {
    mkdirSync(join(configDir, 'plugins'), { recursive: true });
    writeFileSync(join(configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }));
  }
  return { kitHome, configDir };
}

/** A kit home whose `current` names a version, with the kit launcher beside the launcher under test. */
export const KIT: KitFixture = { current: '0.510.0\n', kitLauncher: true };

/** A home the kit self-install has not reached: no `current`, and teamrig in Claude Code's plugin list, after a gone install. */
export const PLUGIN_ONLY: KitFixture = { installs: ['gone', 'v2'], empty: ['gone'], lookalike: true };

/** The installs a launcher finds a CLI in: through the kit launcher, or through the plugin list. */
export const INSTALLED: readonly KitFixture[] = [KIT, PLUGIN_ONLY, { current: '0.510.0\n', installs: ['v2'] }];

/**
 * Homes where a launcher finds no CLI: nothing at all, only a lookalike plugin, or a `current` with no kit launcher
 * beside it and no plugin.
 */
export const NOT_INSTALLED: readonly KitFixture[] = [{}, { lookalike: true }, { current: '0.510.0\n' }];

/** A kit launcher that refuses the install, as a broken one does, beside a plugin that would run: the plugin must not. */
export const KIT_REFUSES: KitFixture = {
  ...KIT,
  installs: ['v2'],
  cliText: "process.stderr.write('teamrig: teamrig files changed\\n');\nprocess.exit(1);\n",
  pluginText: "process.stdout.write('unchecked plugin ran');\n",
};
