import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { MemoryFiles } from '../testing/memory-files.ts';
import { formatLastTyped, lastTypedPath, LastTypedStore, parseLastTyped, type LastTyped } from './last-typed.ts';

const KIT_HOME = join('srv', 'kit');
const TYPED: LastTyped = { team: 'alpha', session: 'dev', tab: 'tab-1', at: '2026-11-22T18:00:00.000Z' };

describe('LastTypedStore', () => {
  it('reads nothing before a write, then the last write of any team', async () => {
    const files = new MemoryFiles();
    const store = new LastTypedStore(files, KIT_HOME);
    assert.equal(await store.read(), undefined);
    await store.write(TYPED);
    const later: LastTyped = { team: 'bravo', session: 'ops', tab: 'tab-2', at: '2026-11-22T18:01:00.000Z' };
    await store.write(later);
    assert.deepEqual(await store.read(), later);
    assert.deepEqual(parseLastTyped(files.get(lastTypedPath(KIT_HOME)) ?? ''), later);
  });

  it('keeps the file under the teamrig home, one for every team', () => {
    assert.equal(lastTypedPath(KIT_HOME), join(KIT_HOME, 'last-typed.json'));
  });
});

describe('parseLastTyped', () => {
  it('round-trips a record', () => {
    assert.deepEqual(parseLastTyped(formatLastTyped(TYPED)), TYPED);
  });

  it('reads a damaged file, another format or a missing field as no record', () => {
    assert.equal(parseLastTyped('{not json'), undefined);
    assert.equal(parseLastTyped(JSON.stringify({ v: 2, team: 'alpha', session: 'dev', tab: 'tab-1', at: TYPED.at })), undefined);
    assert.equal(parseLastTyped(JSON.stringify({ v: 1, team: 'alpha', session: 'dev', at: TYPED.at })), undefined);
  });
});
