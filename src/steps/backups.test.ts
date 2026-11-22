import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toJsonlLine } from '../core/jsonl.ts';
import { InlineMutex } from '../testing/inline-mutex.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { StepBackupLedger, type StepBackup, type StepBackupPlace } from './backups.ts';

const LEDGER = '/kit/teams/app/state/step-backups.jsonl';
const BACKUPS = '/kit/teams/app/backups';
const FIRST: StepBackup = { step: 'config-format', path: `${BACKUPS}/config.v7.json`, at: '2030-01-01T10:00:00.000Z' };
const SECOND: StepBackup = { step: 'config-format', path: `${BACKUPS}/config.v8.json`, at: '2030-01-05T10:00:00.000Z' };
const OTHER: StepBackup = { step: 'plugin-install', path: `${BACKUPS}/plugin.json`, at: '2030-01-02T10:00:00.000Z' };
const HAND_MADE = `${BACKUPS}/config.mine.json`;
const STATE_FILE = '/kit/teams/app/state/config.v6.json';

/** The backups folder, where config-format names its backups `config.v<N>.json` and plugin-install `plugin.json`. */
const PLACE: StepBackupPlace = {
  folder: BACKUPS,
  isBackupFile: (step, name) => (step === 'config-format' ? /^config\.v\d+\.json$/.test(name) : step === 'plugin-install' && name === 'plugin.json'),
};

function ledgerOver(files: MemoryFiles, place: StepBackupPlace = PLACE): { readonly ledger: StepBackupLedger; readonly mutex: InlineMutex } {
  const mutex = new InlineMutex();
  return { ledger: new StepBackupLedger(files, LEDGER, mutex, place), mutex };
}

function rowsOf(...backups: readonly StepBackup[]): string {
  return backups.map((backup) => toJsonlLine({ v: 1, ...backup })).join('');
}

describe('StepBackupLedger', () => {
  it('reads nothing before any step ran', async () => {
    assert.deepEqual(await ledgerOver(new MemoryFiles()).ledger.read(), []);
  });

  it("records a step's backup, and its next run removes the earlier one, under the lock", async () => {
    const files = new MemoryFiles({ [FIRST.path]: 'v7', [SECOND.path]: 'v8', [OTHER.path]: 'p', [HAND_MADE]: 'mine' });
    const { ledger, mutex } = ledgerOver(files);
    assert.deepEqual(await ledger.replace(FIRST), { removed: [], refused: [] });
    assert.deepEqual(await ledger.replace(OTHER), { removed: [], refused: [] });
    assert.deepEqual(await ledger.replace(SECOND), { removed: [FIRST.path], refused: [] });
    assert.deepEqual(await ledger.read(), [OTHER, SECOND]);
    assert.deepEqual([files.get(FIRST.path), files.get(SECOND.path), files.get(OTHER.path), files.get(HAND_MADE)], [undefined, 'v8', 'p', 'mine']);
    assert.equal(mutex.runs, 3);
  });

  it('removes only the backups due, never a file it has no row for', async () => {
    const files = new MemoryFiles({ [FIRST.path]: 'v7', [OTHER.path]: 'p', [HAND_MADE]: 'mine' });
    const { ledger } = ledgerOver(files);
    await ledger.replace(FIRST);
    await ledger.replace(OTHER);
    assert.deepEqual(await ledger.removeWhere((backup) => backup.at < '2030-01-02'), { removed: [FIRST.path], refused: [] });
    assert.deepEqual(await ledger.read(), [OTHER]);
    assert.deepEqual([files.get(FIRST.path), files.get(OTHER.path), files.get(HAND_MADE)], [undefined, 'p', 'mine']);
  });

  it('drops the row of a backup already gone, and reports no removal for it', async () => {
    const files = new MemoryFiles({ [SECOND.path]: 'v8' });
    const { ledger } = ledgerOver(files);
    await ledger.replace(FIRST);
    assert.deepEqual(await ledger.replace(SECOND), { removed: [], refused: [] });
    assert.deepEqual(await ledger.read(), [SECOND]);
  });

  it('skips a damaged line and keeps a hand-written last line apart from the next row', async () => {
    const files = new MemoryFiles({ [LEDGER]: `not json\n{"v":1,"step":"config-format","path":"${FIRST.path}"}\n{"v":1,"step":"plugin-install","path":"${OTHER.path}","at":"${OTHER.at}"}` });
    const { ledger } = ledgerOver(files);
    assert.deepEqual(await ledger.read(), [OTHER]);
    await ledger.replace(SECOND);
    assert.deepEqual(await ledger.read(), [OTHER, SECOND]);
  });

  describe('a row that names no step backup in the backups folder is left on disk, refused and dropped', () => {
    const at = '2030-01-01T10:00:00.000Z';
    const outside: StepBackup = { step: 'config-format', path: STATE_FILE, at };
    const climbing: StepBackup = { step: 'config-format', path: `${BACKUPS}/../state/config.v6.json`, at };
    const linked: StepBackup = { step: 'config-format', path: `${BACKUPS}/config.v5.json`, at };
    const otherName: StepBackup = { step: 'config-format', path: HAND_MADE, at };
    const otherStep: StepBackup = { step: 'plugin-install', path: FIRST.path, at };

    function filesWithEach(): MemoryFiles {
      const files = new MemoryFiles({ [STATE_FILE]: 'state', [HAND_MADE]: 'mine', [FIRST.path]: 'v7', [SECOND.path]: 'v8' });
      files.link(linked.path, STATE_FILE);
      return files;
    }

    const named = [
      ['outside the folder', outside],
      ['climbing out with ..', climbing],
      ['a link inside the folder', linked],
      ['another name in the folder', otherName],
    ] as const;

    for (const [why, row] of [...named, ["another step's backup name", otherStep]] as const) {
      it(`at the sweep: ${why}`, async () => {
        const files = filesWithEach();
        await files.write(LEDGER, rowsOf(row, SECOND));
        const { ledger } = ledgerOver(files);
        assert.deepEqual(await ledger.removeWhere(() => true), { removed: [SECOND.path], refused: [row.path] });
        assert.deepEqual(await ledger.read(), []);
        assert.deepEqual([files.get(STATE_FILE), files.get(HAND_MADE), files.get(FIRST.path), files.get(SECOND.path)], ['state', 'mine', 'v7', undefined]);
      });
    }

    for (const [why, row] of named) {
      it(`at the next run: ${why}`, async () => {
        const files = filesWithEach();
        await files.write(LEDGER, rowsOf(row));
        const { ledger } = ledgerOver(files);
        assert.deepEqual(await ledger.replace(SECOND), { removed: [], refused: [row.path] });
        assert.deepEqual(await ledger.read(), [SECOND]);
        assert.deepEqual([files.get(STATE_FILE), files.get(HAND_MADE), files.get(FIRST.path)], ['state', 'mine', 'v7']);
      });
    }

    it('takes the backups folder through a link to it', async () => {
      const files = new MemoryFiles({ [FIRST.path]: 'v7' });
      files.link('/kit/teams/app/backups-link', BACKUPS);
      await files.write(LEDGER, rowsOf(FIRST));
      const { ledger } = ledgerOver(files, { ...PLACE, folder: '/kit/teams/app/backups-link' });
      assert.deepEqual(await ledger.removeWhere(() => true), { removed: [FIRST.path], refused: [] });
    });

    it('removes nothing when the backups folder is gone, and drops the rows that still name a file', async () => {
      const files = new MemoryFiles({ [STATE_FILE]: 'state' });
      await files.write(LEDGER, rowsOf(outside));
      const { ledger } = ledgerOver(files);
      assert.deepEqual(await ledger.removeWhere(() => true), { removed: [], refused: [STATE_FILE] });
      assert.equal(files.get(STATE_FILE), 'state');
    });
  });
});
