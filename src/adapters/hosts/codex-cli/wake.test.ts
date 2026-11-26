import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ProgramResult } from '../../../plugin-api/index.ts';
import { CodexWakeRefusedError, wakeArgs, wakeOutcome } from './wake.ts';

function ended(code: number, stdout: string, stderr: string): ProgramResult {
  return { end: { kind: 'exited', code }, stdout, stderr };
}

describe("Codex CLI's wake", () => {
  it('queues the prompt on the thread, each value joined to its flag', () => {
    assert.deepEqual(wakeArgs('019a-thread', 'read your inbox'), ['queue', '--thread=019a-thread', '--message=read your inbox']);
  });

  it('keeps a prompt or an id starting with "-" a value, never a flag', () => {
    assert.deepEqual(wakeArgs('-t', '--resume now'), ['queue', '--thread=-t', '--message=--resume now']);
  });

  it('passes a prompt of several lines as one argument', () => {
    assert.deepEqual(wakeArgs('t', 'one\ntwo').slice(2), ['--message=one\ntwo']);
  });

  it('refuses a blank thread or a blank prompt before Codex runs', () => {
    assert.throws(() => wakeArgs(' ', 'x'), CodexWakeRefusedError);
    assert.throws(() => wakeArgs('t', ' \n'), CodexWakeRefusedError);
  });

  it('reads an exit 0 as delivered', () => {
    assert.deepEqual(wakeOutcome(ended(0, 'Queued message m-1 for thread t.\n', '')), { kind: 'delivered' });
  });

  it('reads "no active session" as a thread that runs nowhere', () => {
    assert.deepEqual(wakeOutcome(ended(1, '', "Error: No active session found matching 't'.\n")), { kind: 'no-session' });
  });

  it("fails any other refusal with Codex's first line", () => {
    const daemon = 'the local app-server daemon does not support thread/queue/add; update Codex';
    assert.deepEqual(wakeOutcome(ended(1, '', `\n  ${daemon}\nmore\n`)), { kind: 'failed', reason: `codex queue exited 1: ${daemon}` });
  });

  it('fails a silent end or a signal with how it ended', () => {
    assert.deepEqual(wakeOutcome(ended(2, '', '')), { kind: 'failed', reason: 'codex queue exited 2' });
    assert.deepEqual(wakeOutcome({ end: { kind: 'signal', signal: 'SIGTERM' }, stdout: '', stderr: '' }), {
      kind: 'failed',
      reason: 'codex queue was stopped by SIGTERM',
    });
  });
});
