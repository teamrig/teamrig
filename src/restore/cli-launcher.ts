import { join } from 'node:path';
import { FIND_TEAMRIG_CLI } from '../core/launcher-script.ts';
import type { Launcher } from './install-plan.ts';

/**
 * The `teamrig` launchers a session start writes to the kit home's bin folder, which it also puts on the user's PATH
 * (cli-on-path.ts), so `teamrig` runs from any terminal, not only from an AI CLI's own shell, where the plugin's bin
 * folder is on the PATH. The folder never moves while the plugin folder changes with every version, so the launchers
 * name no plugin folder: `teamrig.mjs` finds the installed plugin's CLI on each run (FIND_TEAMRIG_CLI) and runs it in
 * its own Node process, so the CLI's parent is the shell that ran the launcher, as through the plugin's own shims. The
 * shims beside it, `teamrig.cmd` for cmd and PowerShell and `teamrig` for sh shells, run it as the plugin's shims run
 * the CLI (plugins/teamrig/bin).
 */

/** The bin folder under the kit home, which the user's PATH names: `<kit home>/bin`. */
export function cliLauncherFolder(kitHome: string): string {
  return join(kitHome, 'bin');
}

/** The launcher the shims run: `<kit home>/bin/teamrig.mjs`. */
export function cliLauncherPath(kitHome: string): string {
  return join(cliLauncherFolder(kitHome), 'teamrig.mjs');
}

/** The shim cmd and PowerShell run for `teamrig`: `<kit home>/bin/teamrig.cmd`. */
export function cmdShimPath(kitHome: string): string {
  return join(cliLauncherFolder(kitHome), 'teamrig.cmd');
}

/** The shim sh shells run for `teamrig`: `<kit home>/bin/teamrig`. */
export function shShimPath(kitHome: string): string {
  return join(cliLauncherFolder(kitHome), 'teamrig');
}

/**
 * Finds the installed plugin's CLI and runs it in this process: the CLI reads its words from `process.argv` after the
 * script, which are this launcher's own. It exits 1 when no teamrig plugin is installed.
 */
export const CLI_LAUNCHER_SCRIPT = String.raw`// Written by teamrig at a session start, and kept up to date with each plugin version.
// The teamrig CLI from any terminal: the teamrig.cmd and teamrig shims beside it run this file.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

${FIND_TEAMRIG_CLI}

const main = teamrigCli();
if (main === undefined) {
  process.stderr.write('teamrig: not found: no installed teamrig plugin; install it, then run this again\n');
  process.exit(1);
}
await import(pathToFileURL(main).href);
`;

/**
 * The cmd shim, as the plugin's own (plugins/teamrig/bin/teamrig.cmd): cmd ends `%*` at a line break, so it also hands
 * the CLI cmd's whole command line, read with delayed expansion, which keeps the line breaks (src/cli/cmd-shim.ts).
 * cmd looks for a bare `node` in the current folder before the PATH, so a repo's own `node.cmd` would run instead:
 * `NoDefaultCurrentDirectoryInExePath`, set inside the setlocal so it ends with the shim, makes it skip that folder.
 */
export const CMD_SHIM_SCRIPT = [
  '@echo off',
  'rem Written by teamrig at a session start: the teamrig CLI for cmd and PowerShell, through teamrig.mjs beside it.',
  'setlocal EnableDelayedExpansion',
  'set "TEAMRIG_CMD_LINE=!CMDCMDLINE!"',
  'setlocal DisableDelayedExpansion',
  'set "NoDefaultCurrentDirectoryInExePath=1"',
  'node "%~dp0teamrig.mjs" %*',
  '',
].join('\r\n');

/**
 * The walk the plugin's sh shim takes under Git Bash before it runs the CLI (plugins/teamrig/bin/teamrig, which says
 * why): the Windows ids of the shells above it go to the CLI's starter watch. A spec holds the two equal.
 */
export const SH_SHELL_WALK = `if [ -r "/proc/$$/winpid" ]; then
  read -r TEAMRIG_LAUNCHER_WINPID < "/proc/$$/winpid"
  TEAMRIG_SHELL_WINPIDS=
  teamrig_pid=$PPID
  teamrig_hops=0
  while [ "$teamrig_pid" != 1 ] && [ "$teamrig_hops" -lt 16 ]; do
    { read -r teamrig_winpid < "/proc/$teamrig_pid/winpid"; } 2>/dev/null || break
    TEAMRIG_SHELL_WINPIDS=\${TEAMRIG_SHELL_WINPIDS:+$TEAMRIG_SHELL_WINPIDS,}$teamrig_winpid
    { read -r teamrig_pid < "/proc/$teamrig_pid/ppid"; } 2>/dev/null || break
    teamrig_hops=$((teamrig_hops + 1))
  done
  export TEAMRIG_SHELL_WINPIDS TEAMRIG_LAUNCHER_WINPID
fi
`;

/** The sh shim: macOS and Linux shells, and Git Bash on Windows, which runs no `.cmd` for a bare `teamrig`. */
export const SH_SHIM_SCRIPT = `#!/bin/sh
# Written by teamrig at a session start: the teamrig CLI for sh shells, through teamrig.mjs beside it.
${SH_SHELL_WALK}exec node "$(dirname "$0")/teamrig.mjs" "$@"
`;

/**
 * The launchers a session start keeps on the kit home's bin folder for `platform`, each written when missing too:
 * the Node launcher and the sh shim everywhere, and on Windows the cmd shim.
 */
export function cliLaunchers(kitHome: string, platform: NodeJS.Platform): Launcher[] {
  const launchers: Launcher[] = [
    { path: cliLauncherPath(kitHome), text: CLI_LAUNCHER_SCRIPT, create: true },
    { path: shShimPath(kitHome), text: SH_SHIM_SCRIPT, create: true },
  ];
  return platform === 'win32' ? [...launchers, { path: cmdShimPath(kitHome), text: CMD_SHIM_SCRIPT, create: true }] : launchers;
}
