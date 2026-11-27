import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEAMRIG_NOT_FOUND } from '../core/launcher-script.ts';
import { INSTALLED, KIT, KIT_REFUSES, NOT_INSTALLED, writeKit, type KitFixture } from '../testing/kit-fixture.ts';
import { INBOX_ADD_LAUNCHER_SCRIPT, inboxAddLauncherPath } from './host-launcher.ts';

/** A stand-in CLI that prints the words it was given, the team it was told, and exits 3 on `--to zulu`. */
const ECHO_CLI =
  "const argv = process.argv.slice(2);\nprocess.stdout.write(JSON.stringify({ argv, team: process.env.TEAMRIG_TEAM ?? null }));\nif (argv.includes('zulu')) { process.stderr.write('no session zulu\\n'); process.exit(3); }\n";

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the real launcher with Node from the bin folder of a temp kit home, beside the fixture's Claude Code config. */
function launch(fixture: KitFixture, args: readonly string[]): Run {
  const root = mkdtempSync(join(tmpdir(), 'teamrig-inbox-launcher-'));
  try {
    const { kitHome, configDir } = writeKit(root, fixture, ECHO_CLI);
    const launcher = inboxAddLauncherPath(kitHome);
    writeFileSync(launcher, INBOX_ADD_LAUNCHER_SCRIPT);
    const env: Record<string, string | undefined> = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
    delete env['TEAMRIG_TEAM'];
    delete env['TEAMRIG_SESSION'];
    const result = spawnSync(process.execPath, [launcher, ...args], { encoding: 'utf8', env, cwd: root });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const LINE = ['--from', 'host:nightly-backup', '--to', 'alpha', '--text', 'backup failed'];

describe('inbox-add launcher (#930)', () => {
  it('lives in the kit home bin folder, beside the other launchers', () => {
    assert.equal(inboxAddLauncherPath(join('/', 'kit')), join('/', 'kit', 'bin', 'inbox-add.mjs'));
  });

  it("runs inbox add with the job's words through the kit launcher, else through Claude Code's plugin list", () => {
    for (const fixture of INSTALLED) {
      const run = launch(fixture, LINE);
      assert.deepEqual([run.status, JSON.parse(run.stdout)], [0, { argv: ['inbox', 'add', ...LINE], team: null }], JSON.stringify(fixture));
    }
  });

  it('names the team by --team, which it hands on as $TEAMRIG_TEAM', () => {
    const run = launch(KIT, ['--team', 'app', ...LINE]);
    assert.deepEqual(JSON.parse(run.stdout), { argv: ['inbox', 'add', ...LINE], team: 'app' });
  });

  it('reads --team only as the first pair, so a --team word later in the line, such as the text, is passed on as is', () => {
    const words = ['--from', 'host:job', '--text', '--team', '--to', 'alpha'];
    const later = launch(KIT, words);
    assert.deepEqual(JSON.parse(later.stdout), { argv: ['inbox', 'add', ...words], team: null });
    const both = launch(KIT, ['--team', 'app', ...words]);
    assert.deepEqual(JSON.parse(both.stdout), { argv: ['inbox', 'add', ...words], team: 'app' });
  });

  it("exits with the CLI's refusal, and with 1 when it finds no teamrig", () => {
    const refused = launch(KIT, ['--from', 'host:job', '--to', 'zulu', '--text', 'hi']);
    assert.deepEqual([refused.status, refused.stderr], [3, 'no session zulu\n']);
    for (const fixture of NOT_INSTALLED) {
      const missing = launch(fixture, LINE);
      assert.deepEqual([missing.status, missing.stdout, missing.stderr], [1, '', `teamrig inbox-add: ${TEAMRIG_NOT_FOUND}\n`], JSON.stringify(fixture));
    }
  });

  it("passes a kit launcher's refusal on and never runs the plugin's CLI unchecked in its place", () => {
    const run = launch(KIT_REFUSES, LINE);
    assert.deepEqual([run.status, run.stdout, run.stderr], [1, '', 'teamrig: teamrig files changed\n']);
  });
});
