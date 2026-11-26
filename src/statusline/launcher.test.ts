import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { INSTALLED, KIT, KIT_REFUSES, NOT_INSTALLED, PLUGIN_ONLY, writeKit, type KitFixture } from '../testing/kit-fixture.ts';
import { LAUNCHER_SCRIPT, launcherPath } from './launcher.ts';

const MAIN = fileURLToPath(new URL('../cli/main.ts', import.meta.url));
/** A stand-in CLI that prints the words and input it was given. */
const ECHO_CLI = "let input = ''; for await (const chunk of process.stdin) input += chunk;\nprocess.stdout.write(JSON.stringify({ argv: process.argv.slice(2), input }));\n";

/** Runs the real launcher with Node from the bin folder of a temp kit home, beside the fixture's Claude Code config. */
function launch(fixture: KitFixture, args: readonly string[], input: string): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const root = mkdtempSync(join(tmpdir(), 'teamrig-launcher-'));
  try {
    const { kitHome, configDir } = writeKit(root, fixture, ECHO_CLI);
    const launcher = launcherPath(kitHome);
    writeFileSync(launcher, LAUNCHER_SCRIPT);
    const result = spawnSync(process.execPath, [launcher, ...args], {
      input,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, TEAMRIG_HOME: kitHome, TEAMRIG_TEAM: 'app' },
      cwd: root,
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('statusline launcher', () => {
  it('lives in the kit home bin folder', () => {
    assert.equal(launcherPath(join('/', 'kit')), join('/', 'kit', 'bin', 'statusline.mjs'));
  });

  it('runs teamrig statusline through the kit launcher, else the plugin list, on the same input, with --pass when given', () => {
    for (const fixture of INSTALLED) {
      const plain = launch(fixture, [], '{"a":1}');
      assert.deepEqual([plain.status, JSON.parse(plain.stdout)], [0, { argv: ['statusline'], input: '{"a":1}' }], JSON.stringify(fixture));
      const passing = launch(fixture, ['--pass'], '{"a":1}');
      assert.deepEqual(JSON.parse(passing.stdout), { argv: ['statusline', '--pass'], input: '{"a":1}' });
    }
  });

  it('never breaks the status bar: nothing found, a failed run or a kit launcher refusing still exit 0', () => {
    for (const fixture of [...NOT_INSTALLED, { ...KIT, cliText: 'process.exit(3);\n' }, KIT_REFUSES]) {
      const plain = launch(fixture, [], '{"a":1}');
      assert.equal(plain.status, 0);
      assert.match(plain.stdout, /^teamrig (not found|failed)\n$/);
      assert.match(plain.stderr, /teamrig statusline: teamrig (not found|failed)/);
      assert.deepEqual([launch(fixture, ['--pass'], '{"a":1}').stdout], ['{"a":1}']);
    }
  });

  it('with the real CLI and --pass, saves nothing it cannot read and passes the input on', () => {
    const viaMain = `await import(${JSON.stringify(pathToFileURL(MAIN).href)});\n`;
    for (const fixture of [KIT, PLUGIN_ONLY]) {
      const result = launch({ ...fixture, cliText: viaMain }, ['--pass'], '{"model":{}}\n');
      assert.deepEqual([result.status, result.stdout], [0, '{"model":{}}\n']);
    }
  });
});
