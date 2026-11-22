import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InlineMutex } from '../testing/inline-mutex.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { StepBackupLedger, type StepBackup } from './backups.ts';

const LEDGER = '/kit/teams/app/state/step-backups.jsonl';
const FIRST: StepBackup = { step: 'config-format', path: '/kit/teams/app/backups/config.v7.json', at: '2030-01-01T10:00:00.000Z' };
const SECOND: StepBackup = { step: 'config-format', path: '/kit/teams/app/backups/config.v8.json', at: '2030-01-05T10:00:00.000Z' };
const OTHER: StepBackup = { step: 'plugin-install', path: '/kit/teams/app/backups/plugin.json', at: '2030-01-02T10:00:00.000Z' };
const HAND_MADE = '/kit/teams/app/backups/config.mine.json';

function ledgerOver(files: MemoryFiles): { readonly ledger: StepBackupLedger; readonly mutex: InlineMutex } {
  const mutex = new InlineMutex();
  return { ledger: new StepBackupLedger(files, LEDGER, mutex), mutex };
}

describe('StepBackupLedger', () => {
  it('reads nothing before any step ran', async () => {
    assert.deepEqual(await ledgerOver(new MemoryFiles()).ledger.read(), []);
  });

  it("records a step's backup, and its next run removes the earlier one, under the lock", async () => {
    const files = new MemoryFiles({ [FIRST.path]: 'v7', [SECOND.path]: 'v8', [OTHER.path]: 'p', [HAND_MADE]: 'mine' });
    const { ledger, mutex } = ledgerOver(files);
    assert.deepEqual(await ledger.replace(FIRST), []);
    assert.deepEqual(await ledger.replace(OTHER), []);
    assert.deepEqual(await ledger.replace(SECOND), [FIRST.path]);
    assert.deepEqual(await ledger.read(), [OTHER, SECOND]);
    assert.deepEqual([files.get(FIRST.path), files.get(SECOND.path), files.get(OTHER.path), files.get(HAND_MADE)], [undefined, 'v8', 'p', 'mine']);
    assert.equal(mutex.runs, 3);
  });

  it('removes only the backups due, never a file it has no row for', async () => {
    const files = new MemoryFiles({ [FIRST.path]: 'v7', [OTHER.path]: 'p', [HAND_MADE]: 'mine' });
    const { ledger } = ledgerOver(files);
    await ledger.replace(FIRST);
    await ledger.replace(OTHER);
    assert.deepEqual(await ledger.removeWhere((backup) => backup.at < '2030-01-02'), [FIRST.path]);
    assert.deepEqual(await ledger.read(), [OTHER]);
    assert.deepEqual([files.get(FIRST.path), files.get(OTHER.path), files.get(HAND_MADE)], [undefined, 'p', 'mine']);
  });

  it('drops the row of a backup already gone, and reports no removal for it', async () => {
    const files = new MemoryFiles({ [SECOND.path]: 'v8' });
    const { ledger } = ledgerOver(files);
    await ledger.replace(FIRST);
    assert.deepEqual(await ledger.replace(SECOND), []);
    assert.deepEqual(await ledger.read(), [SECOND]);
  });

  it('skips a damaged line and keeps a hand-written last line apart from the next row', async () => {
    const files = new MemoryFiles({ [LEDGER]: `not json\n{"v":1,"step":"config-format","path":"${FIRST.path}"}\n{"v":1,"step":"plugin-install","path":"${OTHER.path}","at":"${OTHER.at}"}` });
    const { ledger } = ledgerOver(files);
    assert.deepEqual(await ledger.read(), [OTHER]);
    await ledger.replace(SECOND);
    assert.deepEqual(await ledger.read(), [OTHER, SECOND]);
  });
});
