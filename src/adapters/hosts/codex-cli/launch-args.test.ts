import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionStart } from '../../../plugin-api/index.ts';
import { CodexLaunchRefusedError, launchArgs, PROGRAM } from './launch-args.ts';

const NEW: SessionStart = { name: undefined, model: undefined, effort: undefined, resume: undefined, settingsFile: undefined, prompt: undefined };

describe("Codex CLI's launch arguments", () => {
  it("names npm's `codex` program", () => {
    assert.equal(PROGRAM, 'codex');
  });

  it('passes nothing for a new session left to Codex', () => {
    assert.deepEqual(launchArgs(NEW), []);
  });

  it('resumes the session it names with the `resume` subcommand first', () => {
    assert.deepEqual(launchArgs({ ...NEW, resume: 'thread-1', model: 'gpt-5' }), ['resume', 'thread-1', '--model', 'gpt-5']);
  });

  it('sets the model with --model and the effort through the model_reasoning_effort config key', () => {
    assert.deepEqual(launchArgs({ ...NEW, model: 'gpt-5', effort: 'high' }), ['--model', 'gpt-5', '-c', 'model_reasoning_effort=high']);
  });

  it('puts the first prompt last, as one argument after `--`, behind every flag', () => {
    const args = launchArgs({ ...NEW, resume: 't', model: 'm', effort: 'low', prompt: 'start --model x' });
    assert.deepEqual(args, ['resume', 't', '--model', 'm', '-c', 'model_reasoning_effort=low', '--', 'start --model x']);
  });

  it('keeps a prompt starting with "-" behind `--`, so Codex never reads it as a flag', () => {
    assert.deepEqual(launchArgs({ ...NEW, prompt: '--dangerously-bypass-approvals-and-sandbox' }), ['--', '--dangerously-bypass-approvals-and-sandbox']);
  });

  it('refuses a resume id starting with "-" rather than pass it where Codex reads a flag', () => {
    assert.throws(() => launchArgs({ ...NEW, resume: '--full-auto' }), CodexLaunchRefusedError);
  });

  it('passes nothing for a shown name or a settings file, since Codex has no flag for either', () => {
    assert.deepEqual(launchArgs({ ...NEW, name: 'tr-dev', settingsFile: 'team-settings.json' }), []);
  });
});
