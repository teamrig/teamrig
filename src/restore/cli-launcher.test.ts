import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePluginList, type PluginListFixture } from '../testing/plugin-list.ts';
import {
  CLI_LAUNCHER_SCRIPT,
  CMD_SHIM_SCRIPT,
  cliLauncherFolder,
  cliLauncherPath,
  cliLaunchers,
  cmdShimPath,
  SH_SHELL_WALK,
  SH_SHIM_SCRIPT,
  shShimPath,
} from './cli-launcher.ts';

/** A stand-in CLI that prints the words it was given, and exits 3 on `zulu`. */
const ECHO_CLI =
  "const argv = process.argv.slice(2);\nprocess.stdout.write(JSON.stringify(argv));\nif (argv.includes('zulu')) { process.stderr.write('no session zulu\\n'); process.exit(3); }\n";

const PLUGIN_SH_SHIM = readFileSync(new URL('../../plugins/teamrig/bin/teamrig', import.meta.url), 'utf8');
const PLUGIN_CMD_SHIM = readFileSync(new URL('../../plugins/teamrig/bin/teamrig.cmd', import.meta.url), 'utf8');

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the real `teamrig.mjs` with Node in a temp folder holding a Claude Code config folder and the given plugins. */
function launch(fixture: PluginListFixture, args: readonly string[]): Run {
  const root = mkdtempSync(join(tmpdir(), 'teamrig-cli-launcher-'));
  try {
    const config = writePluginList(root, fixture, ECHO_CLI);
    const kit = join(root, 'kit');
    mkdirSync(cliLauncherFolder(kit), { recursive: true });
    writeFileSync(cliLauncherPath(kit), CLI_LAUNCHER_SCRIPT);
    const result = spawnSync(process.execPath, [cliLauncherPath(kit), ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: config }, cwd: root });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('the teamrig launchers in the kit home (T5095)', () => {
  it('live in the kit home bin folder', () => {
    const kit = join('/', 'kit');
    assert.deepEqual(
      [cliLauncherFolder(kit), cliLauncherPath(kit), cmdShimPath(kit), shShimPath(kit)],
      [join(kit, 'bin'), join(kit, 'bin', 'teamrig.mjs'), join(kit, 'bin', 'teamrig.cmd'), join(kit, 'bin', 'teamrig')],
    );
  });

  it("runs the installed plugin's CLI with the words it was given, and finds it again after an update moves it", () => {
    const words = ['set', 'T1', '--note', 'a b'];
    for (const installs of [['v2'], ['gone', 'v3']]) {
      const run = launch({ installs, empty: ['gone'], lookalike: true }, words);
      assert.deepEqual([run.status, JSON.parse(run.stdout)], [0, words], installs.join());
    }
  });

  it("exits with the CLI's own code, and with 1 when no teamrig plugin is installed", () => {
    const refused = launch({ installs: ['v2'] }, ['inbox', 'add', '--to', 'zulu']);
    assert.deepEqual([refused.status, refused.stderr], [3, 'no session zulu\n']);
    for (const fixture of [{ noPluginList: true }, { lookalike: true }] satisfies PluginListFixture[]) {
      const missing = launch(fixture, ['check']);
      assert.deepEqual([missing.status, missing.stderr], [1, 'teamrig: not found: no installed teamrig plugin; install it, then run this again\n']);
    }
  });

  it("walks the shells above it as the plugin's sh shim does, then runs teamrig.mjs beside it", () => {
    assert.ok(PLUGIN_SH_SHIM.replaceAll('\r\n', '\n').includes(SH_SHELL_WALK));
    assert.ok(SH_SHIM_SCRIPT.startsWith('#!/bin/sh\n'));
    assert.ok(SH_SHIM_SCRIPT.endsWith(`${SH_SHELL_WALK}exec node "$(dirname "$0")/teamrig.mjs" "$@"\n`));
  });

  it("hands the CLI cmd's whole command line as the plugin's cmd shim does, with CRLF line ends", () => {
    const pluginLines = PLUGIN_CMD_SHIM.split(/\r?\n/);
    const lines = CMD_SHIM_SCRIPT.split('\r\n');
    for (const line of ['@echo off', 'setlocal EnableDelayedExpansion', 'set "TEAMRIG_CMD_LINE=!CMDCMDLINE!"', 'setlocal DisableDelayedExpansion']) {
      assert.ok(pluginLines.includes(line) && lines.includes(line), line);
    }
    assert.equal(lines.at(-2), 'node "%~dp0teamrig.mjs" %*');
    assert.equal(CMD_SHIM_SCRIPT.replaceAll('\r\n', '').includes('\n'), false);
  });

  it('finds node on the PATH alone, never in the current folder, setting that inside its setlocal', () => {
    const lines = CMD_SHIM_SCRIPT.split('\r\n');
    const skip = lines.indexOf('set "NoDefaultCurrentDirectoryInExePath=1"');
    assert.ok(skip > lines.indexOf('setlocal DisableDelayedExpansion') && skip < lines.indexOf('node "%~dp0teamrig.mjs" %*'), CMD_SHIM_SCRIPT);
    const pluginLines = PLUGIN_CMD_SHIM.split(/\r?\n/);
    const pluginSkip = pluginLines.indexOf('set "NoDefaultCurrentDirectoryInExePath=1"');
    const pluginNode = pluginLines.indexOf('node "%~dp0..\\dist\\cli\\main.js" %*');
    assert.ok(pluginSkip > pluginLines.indexOf('setlocal DisableDelayedExpansion') && pluginSkip < pluginNode, PLUGIN_CMD_SHIM);
  });

  it('keeps the Node launcher and the sh shim everywhere, and the cmd shim on Windows, each written when missing', () => {
    const kit = join('/', 'kit');
    assert.deepEqual(cliLaunchers(kit, 'linux'), [
      { path: cliLauncherPath(kit), text: CLI_LAUNCHER_SCRIPT, create: true },
      { path: shShimPath(kit), text: SH_SHIM_SCRIPT, create: true },
    ]);
    assert.deepEqual(cliLaunchers(kit, 'darwin'), cliLaunchers(kit, 'linux'));
    assert.deepEqual(cliLaunchers(kit, 'win32'), [...cliLaunchers(kit, 'linux'), { path: cmdShimPath(kit), text: CMD_SHIM_SCRIPT, create: true }]);
  });
});
