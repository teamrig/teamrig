import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { backgroundJobSession, isForkOf, sessionPlaceOf } from './session-command-lines.ts';

describe("Codex CLI's session command lines", () => {
  it('reads `fork <SESSION_ID>` as a fork of that session, shown with spaces or given with NULs', () => {
    assert.equal(isForkOf('codex fork thread-1', 'thread-1'), true);
    assert.equal(isForkOf('node\0/usr/lib/node_modules/@openai/codex/bin/codex.js\0fork\0thread-1\0', 'thread-1'), true);
  });

  it('reads no fork of another session, a `fork --last`, a resume or an empty line', () => {
    assert.equal(isForkOf('codex fork thread-2', 'thread-1'), false);
    assert.equal(isForkOf('codex fork --last', 'thread-1'), false);
    assert.equal(isForkOf('codex resume thread-1', 'thread-1'), false);
    assert.equal(isForkOf('', 'thread-1'), false);
  });

  it('names no background job session and no place, since Codex tells neither', () => {
    assert.equal(backgroundJobSession([{ name: 'codex.exe', commandLine: 'codex fork thread-1' }]), undefined);
    assert.equal(sessionPlaceOf({ startedAs: 'cli', sessionKind: 'tab' }), undefined);
  });
});
