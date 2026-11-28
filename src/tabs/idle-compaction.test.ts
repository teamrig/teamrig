import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { MemoryFiles } from '../testing/memory-files.ts';
import { IDLE_COMPACTION_FORMAT, IdleCompactionStore, onEmptyPrompt } from './idle-compaction.ts';

const PATHS = { tabs: join('/', 'team', 'state', 'tabs') };
const NOTE = join(PATHS.tabs, 'idle-compactions', 'alpha.json');
const AT = '2030-01-08T10:00:00.000Z';

describe('onEmptyPrompt', () => {
  it('holds for the states a tab shows between turns, not for one inside a turn', () => {
    assert.deepEqual((['ready', 'decision', 'error'] as const).map(onEmptyPrompt), [true, true, true]);
    assert.deepEqual((['working', 'waiting', 'compacting'] as const).map(onEmptyPrompt), [false, false, false]);
  });
});

describe('IdleCompactionStore', () => {
  it("takes the note once: its compaction's end finds it, a second end finds none", async () => {
    const files = new MemoryFiles();
    const notes = new IdleCompactionStore(files, PATHS);
    await notes.note('alpha', AT);
    assert.equal(await notes.take('alpha'), true);
    assert.equal(await notes.take('alpha'), false);
    assert.equal(await files.read(NOTE), undefined);
  });

  it("keeps one session's note apart from another's", async () => {
    const notes = new IdleCompactionStore(new MemoryFiles(), PATHS);
    await notes.note('alpha', AT);
    assert.equal(await notes.take('beta'), false);
    assert.equal(await notes.take('alpha'), true);
  });

  it('removes a note, as a compaction inside a turn or the session end does, and says whether there was one', async () => {
    const notes = new IdleCompactionStore(new MemoryFiles(), PATHS);
    await notes.note('alpha', AT);
    assert.equal(await notes.remove('alpha'), true);
    assert.equal(await notes.remove('alpha'), false);
    assert.equal(await notes.take('alpha'), false);
  });

  it('reads a damaged note or one in another format as none, and still removes it', async () => {
    const files = new MemoryFiles();
    const notes = new IdleCompactionStore(files, PATHS);
    for (const text of ['not json\n', `{"v":${IDLE_COMPACTION_FORMAT + 1},"at":"${AT}"}\n`, `{"v":${IDLE_COMPACTION_FORMAT},"at":"later"}\n`, '{}\n']) {
      await files.write(NOTE, text);
      assert.equal(await notes.take('alpha'), false, text);
      assert.equal(await files.read(NOTE), undefined, text);
    }
  });
});
