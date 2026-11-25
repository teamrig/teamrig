import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { backgroundJobSession, isForkOf, sessionPlaceOf } from './session-command-lines.ts';

describe("Antigravity CLI's session command lines", () => {
  it('reads no command line as a fork, since agy forks only by its /fork slash command', () => {
    assert.equal(isForkOf('agy --conversation conv-1', 'conv-1'), false);
    assert.equal(isForkOf('agy fork conv-1', 'conv-1'), false);
    assert.equal(isForkOf('', 'conv-1'), false);
  });

  it('names no background job session and no place, since agy tells neither', () => {
    assert.equal(backgroundJobSession([{ name: 'agy.exe', commandLine: 'agy --conversation conv-1' }]), undefined);
    assert.equal(sessionPlaceOf({ startedAs: 'cli', sessionKind: 'tab' }), undefined);
  });
});
