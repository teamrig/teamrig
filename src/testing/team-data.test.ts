import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFiles } from './memory-files.ts';
import { isActLogPath, teamDataOf } from './team-data.ts';

describe('teamDataOf', () => {
  it("leaves out a team's act log and its lock, and keeps every other file, a same-named one outside state too", async () => {
    const files = new MemoryFiles();
    await files.write('/kit/teams/app/state/acts.jsonl', '{"v":1}\n');
    await files.write('/kit/teams/app/state/acts.lock', '');
    await files.write('/kit/teams/app/state/events.jsonl', 'event\n');
    await files.write('/kit/teams/app/notes/acts.jsonl', 'a note\n');
    assert.deepEqual(teamDataOf(files), [
      ['/kit/teams/app/notes/acts.jsonl', 'a note\n'],
      ['/kit/teams/app/state/events.jsonl', 'event\n'],
    ]);
  });

  it('reads a Windows path the way MemoryFiles keys it', () => {
    assert.equal(isActLogPath('C:\\kit\\teams\\app\\state\\acts.jsonl'), true);
    assert.equal(isActLogPath('C:\\kit\\teams\\app\\state\\acts.jsonl.bak'), false);
  });
});
