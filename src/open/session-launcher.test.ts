import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEAMRIG_NOT_FOUND } from '../core/launcher-script.ts';
import { KIT, INSTALLED, writeKit, type KitFixture } from '../testing/kit-fixture.ts';
import type { RunRequest } from './processes.ts';
import { SESSION_LAUNCHER_SCRIPT, sessionLauncherPath } from './session-launcher.ts';
import { STEP_HANDOFF_VAR } from './step-handoff.ts';

/**
 * A stand-in CLI for `launch --step`: it adds the words it was given to CALLS_OUT, hands PLAN on the step pipe on the
 * first start (no --ended), and exits STEP_EXIT.
 */
const STEP_CLI = [
  "import { appendFileSync, writeSync } from 'node:fs';",
  'const words = process.argv.slice(2);',
  "appendFileSync(process.env.CALLS_OUT, JSON.stringify(words) + '\\n');",
  `if (!words.includes('--ended') && process.env.PLAN !== undefined) writeSync(Number(process.env.${STEP_HANDOFF_VAR}), process.env.PLAN);`,
  "process.exit(Number(process.env.STEP_EXIT ?? '0'));",
  '',
].join('\n');

/** A host program that writes whether it saw the step pipe's variable, and where it ran, to HOST_OUT, then exits 5. */
const HOST_PROGRAM = `require('node:fs').writeFileSync(process.env.HOST_OUT, JSON.stringify({ handoff: process.env.${STEP_HANDOFF_VAR} ?? null, cwd: process.cwd() })); process.exit(5);`;

const LINE = ['launch', 'alpha', '--team', 'app', '--project', 'C:/work/app'];

interface Tab {
  readonly status: number | null;
  readonly stdout: string;
  /** The words each step was run with, in order. */
  readonly calls: readonly (readonly string[])[];
  /** What the host program wrote; undefined when it never ran. */
  readonly host: unknown;
}

function isWords(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((word): word is string => typeof word === 'string');
}

function callsIn(path: string): string[][] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, 'utf8').trim().split('\n').map((line) => {
    const words: unknown = JSON.parse(line);
    assert.ok(isWords(words), 'the CLI wrote a list of words');
    return words;
  });
}

/** Runs the real launcher from a kit home's bin folder with `LINE`, as a tab does, to its end. */
function tab(fixture: KitFixture, plan: (root: string) => RunRequest | string | undefined, stepExit = 0): Tab {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'teamrig-session-launcher-')));
  try {
    const { kitHome, configDir } = writeKit(root, fixture, STEP_CLI);
    const launcher = sessionLauncherPath(kitHome);
    writeFileSync(launcher, SESSION_LAUNCHER_SCRIPT);
    const given = plan(root);
    const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: configDir, CALLS_OUT: join(root, 'calls.jsonl'), STEP_EXIT: String(stepExit) };
    if (given !== undefined) {
      env['PLAN'] = typeof given === 'string' ? given : JSON.stringify(given);
    }
    const result = spawnSync(process.execPath, [launcher, ...LINE], { encoding: 'utf8', env, cwd: root });
    const hostOut = join(root, 'host.json');
    const host: unknown = existsSync(hostOut) ? JSON.parse(readFileSync(hostOut, 'utf8')) : undefined;
    return { status: result.status, stdout: result.stdout, calls: callsIn(join(root, 'calls.jsonl')), host };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The host program as a step hands it on, with the step pipe's variable set, which the launcher must take out. */
function hostPlan(root: string, command: string = process.execPath): RunRequest {
  return { command, args: ['-e', HOST_PROGRAM], cwd: root, env: { ...stringEnv(), HOST_OUT: join(root, 'host.json'), [STEP_HANDOFF_VAR]: '3' } };
}

function stringEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return env;
}

const STARTED_AT = /^\d+$/;

describe('session launcher', () => {
  it('lives in the kit home bin folder', () => {
    assert.equal(sessionLauncherPath(join('/', 'kit')), join('/', 'kit', 'bin', 'session-launch.mjs'));
  });

  it("runs the program a step hands on in the tab, without the pipe's variable, then tells the next step how it ended", () => {
    for (const fixture of INSTALLED) {
      let root = '';
      const run = tab(fixture, (folder) => {
        root = folder;
        return hostPlan(folder);
      });
      assert.equal(run.status, 0, JSON.stringify(fixture));
      assert.deepEqual(run.host, { handoff: null, cwd: root });
      assert.equal(run.calls.length, 2);
      assert.deepEqual(run.calls[0], [...LINE, '--step']);
      const [, second = []] = run.calls;
      assert.deepEqual(second.slice(0, -1), [...LINE, '--step', '--ended', 'exited:5', '--started-at']);
      assert.match(second.at(-1) ?? '', STARTED_AT);
    }
  });

  it('tells the next step the program is missing when it is not there', () => {
    const run = tab(KIT, (root) => hostPlan(root, join(root, 'no-such-program')));
    assert.equal(run.status, 0);
    assert.deepEqual(run.calls[1]?.slice(LINE.length, -1), ['--step', '--ended', 'missing', '--started-at']);
  });

  it("ends the tab with a step's exit when it hands no program on", () => {
    const run = tab(KIT, () => undefined, 3);
    assert.deepEqual([run.status, run.calls, run.host], [3, [[...LINE, '--step']], undefined]);
  });

  it('refuses a handed-on start that is not one, running nothing', () => {
    const run = tab(KIT, () => JSON.stringify({ command: 'claude', args: 'not a list' }));
    assert.deepEqual([run.status, run.stdout.trim(), run.calls.length, run.host], [1, 'FAILED: teamrig launch handed on a start that is not one', 1, undefined]);
  });

  it('says why when it finds no teamrig', () => {
    const run = tab({}, () => undefined);
    assert.deepEqual([run.status, run.stdout.trim(), run.calls], [1, `FAILED: ${TEAMRIG_NOT_FOUND}`, []]);
  });
});
