import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFiles } from '../testing/memory-files.ts';
import { readAllowRecord, sameRecord, withOwned, writeAllowRecord } from './allow-record.ts';
import { RefusedError } from './runtime.ts';

const RECORD = '/kit/synced-allow-rules.json';
const SETTINGS = '/user/.claude/settings.json';

describe('allow record', () => {
  it('reads a missing record as empty', async () => {
    assert.deepEqual(await readAllowRecord(new MemoryFiles(), RECORD), new Map());
  });

  it('reads back what it writes', async () => {
    const files = new MemoryFiles();
    const record = withOwned(new Map(), SETTINGS, ['Bash(teamrig list *)', 'PowerShell(teamrig list *)']);
    await writeAllowRecord(files, RECORD, record);
    assert.ok(sameRecord(await readAllowRecord(files, RECORD), record));
  });

  it('refuses a record that is not JSON, not an object, or not string lists', async () => {
    for (const text of ['{', '[]', JSON.stringify({ [SETTINGS]: [1] })]) {
      await assert.rejects(readAllowRecord(new MemoryFiles({ [RECORD]: text }), RECORD), RefusedError, text);
    }
  });

  it('drops a file left with no rules, and names each rule once', () => {
    const record = withOwned(new Map(), SETTINGS, ['A', 'A', 'B']);
    assert.deepEqual(record.get(SETTINGS), ['A', 'B']);
    assert.equal(withOwned(record, SETTINGS, []).size, 0);
  });

  it('tells records apart by file, rule and order', () => {
    const record = withOwned(new Map(), SETTINGS, ['A', 'B']);
    assert.ok(sameRecord(record, withOwned(new Map(), SETTINGS, ['A', 'B'])));
    assert.ok(!sameRecord(record, withOwned(new Map(), SETTINGS, ['B', 'A'])));
    assert.ok(!sameRecord(record, withOwned(new Map(), '/other.json', ['A', 'B'])));
    assert.ok(!sameRecord(record, new Map()));
  });
});
