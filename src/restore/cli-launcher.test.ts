import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CMD_SHIM_SCRIPT,
  cliLauncherFolder,
  cliLauncherPath,
  cliLaunchers,
  cmdShimPath,
  KIT_LAUNCHER_FILE,
  SH_SHELL_WALK,
  SH_SHIM_SCRIPT,
  shShimPath,
} from './cli-launcher.ts';

const PLUGIN_SH_SHIM = readFileSync(new URL('../../plugins/teamrig/bin/teamrig', import.meta.url), 'utf8');
const PLUGIN_CMD_SHIM = readFileSync(new URL('../../plugins/teamrig/bin/teamrig.cmd', import.meta.url), 'utf8');

describe('the teamrig launchers in the kit home (T5095)', () => {
  it('live in the kit home bin folder', () => {
    const kit = join('/', 'kit');
    assert.deepEqual(
      [cliLauncherFolder(kit), cliLauncherPath(kit), cmdShimPath(kit), shShimPath(kit)],
      [join(kit, 'bin'), join(kit, 'bin', 'teamrig.mjs'), join(kit, 'bin', 'teamrig.cmd'), join(kit, 'bin', 'teamrig')],
    );
  });

  it('copies the kit launcher from where the build compiles src/kit/launcher.ts (T5278)', () => {
    const build: unknown = JSON.parse(readFileSync(new URL('../../tsconfig.build.json', import.meta.url), 'utf8'));
    assert.ok(JSON.stringify(build).includes('"rootDir":"src"') && JSON.stringify(build).includes('"outDir":"plugins/teamrig/dist"'));
    assert.equal(KIT_LAUNCHER_FILE, 'dist/kit/launcher.js');
    assert.ok(existsSync(new URL('../kit/launcher.ts', import.meta.url)));
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
    const text = '// the kit launcher\n';
    assert.deepEqual(cliLaunchers(kit, 'linux', text), [
      { path: cliLauncherPath(kit), text, create: true },
      { path: shShimPath(kit), text: SH_SHIM_SCRIPT, create: true },
    ]);
    assert.deepEqual(cliLaunchers(kit, 'darwin', text), cliLaunchers(kit, 'linux', text));
    assert.deepEqual(cliLaunchers(kit, 'win32', text), [...cliLaunchers(kit, 'linux', text), { path: cmdShimPath(kit), text: CMD_SHIM_SCRIPT, create: true }]);
  });
});
