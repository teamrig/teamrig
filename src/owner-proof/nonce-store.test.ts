import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LockBusyError, type Mutex } from '../core/lock.ts';
import { BusyMutex } from '../testing/busy-mutex.ts';
import { FakeClock } from '../testing/fake-clock.ts';
import { InlineMutex } from '../testing/inline-mutex.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { NONCE_LEDGER_VERSION, NonceLedger, NonceLedgerError, ledgerText, parseLedger } from './nonce-store.ts';

const PATH = 'team/state/owner-proof-nonces.json';
const ACT = 'a'.repeat(64);
const OTHER_ACT = 'b'.repeat(64);

/** Random bytes that count up, so each nonce is known in advance: 01 01 ..., 02 02 ... */
function countingRandom(): (size: number) => Buffer {
  let calls = 0;
  return (size) => {
    calls += 1;
    return Buffer.alloc(size, calls);
  };
}

function ledgerOf(files: MemoryFiles, clock: FakeClock, mutex: Mutex = new InlineMutex(), graceMs = 0): NonceLedger {
  return new NonceLedger({ files, mutex, clock, path: PATH, graceMs, random: countingRandom() });
}

describe('NonceLedger', () => {
  it('issues a nonce for an act and writes it to the file, unused', async () => {
    const files = new MemoryFiles();
    const nonce = await ledgerOf(files, new FakeClock(1000)).issue(ACT, 5000);
    assert.equal(nonce, '01'.repeat(32));
    assert.deepEqual(parseLedger(files.get(PATH), PATH), [{ nonce, actDigest: ACT, expires: 5000, spentBy: null }]);
  });

  it('takes an issued nonce once: the first take reads it issued for its act, the next reads it spent by the first', async () => {
    const files = new MemoryFiles();
    const ledger = ledgerOf(files, new FakeClock(1000));
    const nonce = await ledger.issue(ACT, 5000);
    assert.deepEqual(await ledger.take(nonce, 'ev-1'), { kind: 'issued', actDigest: ACT });
    assert.deepEqual(await ledger.take(nonce, 'ev-2'), { kind: 'used', actDigest: ACT, spentBy: 'ev-1' });
    assert.equal(parseLedger(files.get(PATH), PATH)[0]?.spentBy, 'ev-1');
  });

  it('reads a nonce it never issued as unknown and writes nothing for it', async () => {
    const files = new MemoryFiles();
    const ledger = ledgerOf(files, new FakeClock(1000));
    await ledger.issue(ACT, 5000);
    assert.deepEqual(await ledger.take('f'.repeat(64), 'ev-1'), { kind: 'unknown' });
    assert.equal(parseLedger(files.get(PATH), PATH).length, 1);
  });

  it('keeps each act its own nonce', async () => {
    const files = new MemoryFiles();
    const ledger = ledgerOf(files, new FakeClock(1000));
    const first = await ledger.issue(ACT, 5000);
    const second = await ledger.issue(OTHER_ACT, 5000);
    assert.deepEqual(await ledger.take(second, 'ev-1'), { kind: 'issued', actDigest: OTHER_ACT });
    assert.deepEqual(await ledger.take(first, 'ev-2'), { kind: 'issued', actDigest: ACT });
  });

  it('reads a spent nonce long past its expiry without changing the file', async () => {
    const files = new MemoryFiles();
    const clock = new FakeClock(1000);
    const ledger = ledgerOf(files, clock);
    const nonce = await ledger.issue(ACT, 2000);
    await ledger.take(nonce, 'ev-1');
    const written = files.get(PATH);
    clock.advance(86_400_000);
    assert.deepEqual(await ledger.read(nonce), { kind: 'used', actDigest: ACT, spentBy: 'ev-1' });
    assert.equal(files.get(PATH), written);
  });

  it('drops an entry once past its expiry and the grace, so it then reads as unknown', async () => {
    const files = new MemoryFiles();
    const clock = new FakeClock(1000);
    const ledger = ledgerOf(files, clock, new InlineMutex(), 100);
    const nonce = await ledger.issue(ACT, 2000);
    clock.advance(1050);
    await ledger.issue(OTHER_ACT, 9000);
    assert.equal(parseLedger(files.get(PATH), PATH).length, 2, 'within the grace the entry stays');
    clock.advance(100);
    assert.deepEqual(await ledger.take(nonce, 'ev-1'), { kind: 'unknown' });
    assert.deepEqual(parseLedger(files.get(PATH), PATH).map((each) => each.actDigest), [OTHER_ACT]);
  });

  it('holds the mutex for every read and write', async () => {
    const mutex = new InlineMutex();
    const ledger = ledgerOf(new MemoryFiles(), new FakeClock(1000), mutex);
    const nonce = await ledger.issue(ACT, 5000);
    await ledger.take(nonce, 'ev-1');
    await ledger.read(nonce);
    assert.equal(mutex.runs, 3);
  });

  it('refuses while another process holds the ledger, and writes nothing', async () => {
    const files = new MemoryFiles();
    await assert.rejects(ledgerOf(files, new FakeClock(1000), new BusyMutex()).issue(ACT, 5000), LockBusyError);
    assert.equal(files.get(PATH), undefined);
  });

  for (const [name, text] of [
    ['text that is not JSON', '{'],
    ['another version', JSON.stringify({ v: NONCE_LEDGER_VERSION + 1, nonces: [] })],
    ['no nonce list', JSON.stringify({ v: NONCE_LEDGER_VERSION })],
    ['version 1, which had no spender', JSON.stringify({ v: 1, nonces: [{ nonce: ACT, actDigest: ACT, expires: 1, used: true }] })],
    ['a damaged entry', JSON.stringify({ v: NONCE_LEDGER_VERSION, nonces: [{ nonce: 'short', actDigest: ACT, expires: 1, spentBy: null }] })],
    ['an entry with no spender field', JSON.stringify({ v: NONCE_LEDGER_VERSION, nonces: [{ nonce: ACT, actDigest: ACT, expires: 1 }] })],
    ['an entry spent by an empty id', JSON.stringify({ v: NONCE_LEDGER_VERSION, nonces: [{ nonce: ACT, actDigest: ACT, expires: 1, spentBy: '' }] })],
  ] as const) {
    it(`refuses a take or a read on a ledger file holding ${name}, and leaves the file as it was`, async () => {
      const files = new MemoryFiles({ [PATH]: text });
      await assert.rejects(ledgerOf(files, new FakeClock(1000)).take(ACT, 'ev-1'), NonceLedgerError);
      await assert.rejects(ledgerOf(files, new FakeClock(1000)).read(ACT), NonceLedgerError);
      assert.equal(files.get(PATH), text);
    });
  }
});

describe('ledgerText', () => {
  it('reads back as the entries it was written from, spent or not', () => {
    const entries = [
      { nonce: ACT, actDigest: OTHER_ACT, expires: 42, spentBy: 'ev-1' },
      { nonce: OTHER_ACT, actDigest: ACT, expires: 43, spentBy: null },
    ];
    assert.deepEqual(parseLedger(ledgerText(entries), PATH), entries);
  });
});
