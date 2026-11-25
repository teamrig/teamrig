import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionStart } from '../../../plugin-api/index.ts';
import { AntigravityLaunchRefusedError, launchArgs, PROGRAM } from './launch-args.ts';

const NEW: SessionStart = { name: undefined, model: undefined, effort: undefined, resume: undefined, settingsFile: undefined, prompt: undefined };

describe("Antigravity CLI's launch arguments", () => {
  it('names the `agy` program', () => {
    assert.equal(PROGRAM, 'agy');
  });

  it('passes nothing for a new session left to agy', () => {
    assert.deepEqual(launchArgs(NEW), []);
  });

  it('resumes the conversation it names with --conversation', () => {
    assert.deepEqual(launchArgs({ ...NEW, resume: 'conv-1' }), ['--conversation', 'conv-1']);
  });

  it('sets the model with --model and the effort with --effort', () => {
    assert.deepEqual(launchArgs({ ...NEW, model: 'gemini-3-pro', effort: 'high' }), ['--model', 'gemini-3-pro', '--effort', 'high']);
  });

  it('hands the first prompt whole, as the one value of -i, after every other flag', () => {
    const args = launchArgs({ ...NEW, resume: 'c', model: 'm', effort: 'low', prompt: 'read your handover --model x' });
    assert.deepEqual(args, ['--conversation', 'c', '--model', 'm', '--effort', 'low', '-i', 'read your handover --model x']);
  });

  it('refuses a value starting with "-" rather than pass it where agy may read a flag', () => {
    for (const start of [{ ...NEW, resume: '--yolo' }, { ...NEW, model: '-x' }, { ...NEW, effort: '--max' }, { ...NEW, prompt: '--help' }]) {
      assert.throws(() => launchArgs(start), AntigravityLaunchRefusedError, JSON.stringify(start));
    }
  });

  it('passes nothing for a shown name or a settings file, since agy has no flag for either', () => {
    assert.deepEqual(launchArgs({ ...NEW, name: 'tr-dev', settingsFile: 'team-settings.json' }), []);
  });
});
