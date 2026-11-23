import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeLaunchRefusedError, launchArgs, PROGRAM } from './launch-args.ts';
import { sessionLauncher } from './session-launcher.ts';

const BARE = { name: undefined, model: undefined, effort: undefined, resume: undefined, settingsFile: undefined, prompt: undefined };
const SESSION = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe("Claude Code's launch arguments", () => {
  it('passes no argument for a start that leaves every part to Claude Code', () => {
    assert.deepEqual(launchArgs(BARE), []);
  });

  it('spells each part that is set as its flag, in one order, with the first prompt last', () => {
    const start = { name: 'app-alpha', model: 'sonnet', effort: 'max', resume: SESSION, settingsFile: '/state/launch/alpha.settings.json', prompt: 'Go on' };
    assert.deepEqual(launchArgs(start), [
      '--model',
      'sonnet',
      '--effort',
      'max',
      '--settings',
      '/state/launch/alpha.settings.json',
      '--resume',
      SESSION,
      '--name',
      'app-alpha',
      '--',
      'Go on',
    ]);
  });

  it('leaves out the flag of a part that is not set, and keeps the others', () => {
    assert.deepEqual(launchArgs({ ...BARE, name: 'app-alpha' }), ['--name', 'app-alpha']);
    assert.deepEqual(launchArgs({ ...BARE, effort: 'high', resume: SESSION }), ['--effort', 'high', '--resume', SESSION]);
    assert.deepEqual(launchArgs({ ...BARE, model: 'opus', prompt: 'Build it' }), ['--model', 'opus', '--', 'Build it']);
  });

  it('hands the prompt over as one argument after `--`, whatever it holds', () => {
    const prompt = 'Build the "form"; then test\nnext & $(id)';
    assert.deepEqual(launchArgs({ ...BARE, name: 'app-alpha', prompt }), ['--name', 'app-alpha', '--', prompt]);
  });

  it('keeps a prompt starting with "-" behind `--`, so Claude Code never reads it as a flag', () => {
    assert.deepEqual(launchArgs({ ...BARE, prompt: '--some-flag' }), ['--', '--some-flag']);
  });

  it('refuses a resume id starting with "-" rather than pass it where Claude Code reads a flag', () => {
    assert.throws(() => launchArgs({ ...BARE, resume: '--some-flag' }), ClaudeLaunchRefusedError);
  });

  it('is what the session launcher starts a session by, with the program named claude', () => {
    const launcher = sessionLauncher({});
    assert.equal(launcher.program, 'claude');
    assert.equal(launcher.program, PROGRAM);
    assert.deepEqual(launcher.launchArgs({ ...BARE, name: 'app-alpha' }), ['--name', 'app-alpha']);
  });
});
