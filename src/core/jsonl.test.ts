import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFiles } from '../testing/memory-files.ts';
import { appendJsonlLines, assertWritable, NewerDataError, parseJsonl, recordVersion, toJsonlLine, writableObject } from './jsonl.ts';

describe('appendJsonlLines', () => {
  const PATH = '/logs/events.jsonl';
  const LINE = '{"v":1,"b":2}\n';

  it('starts the appended lines on a line of their own after a last line left without its newline', async () => {
    for (const [before, after] of [
      ['{"v":1,"a":1}\n{"v":1,"to', `{"v":1,"a":1}\n{"v":1,"to\n${LINE}`],
      ['{"v":1,"a":1}', `{"v":1,"a":1}\n${LINE}`],
      ['{"v":1,"a":"é"}', `{"v":1,"a":"é"}\n${LINE}`],
    ] as const) {
      const files = new MemoryFiles({ [PATH]: before });
      await appendJsonlLines(files, PATH, LINE);
      assert.equal(files.get(PATH), after, before);
      assert.deepEqual(
        parseJsonl(files.get(PATH) ?? '').records.map((record) => record.raw),
        [...parseJsonl(`${before}\n`).records.map((record) => record.raw), LINE.trimEnd()],
        before,
      );
    }
  });

  it('adds no newline to a file ending in one, an empty file or a missing one, and writes nothing for no lines', async () => {
    for (const [initial, after] of [
      [{ [PATH]: '{"v":1,"a":1}\r\n' }, `{"v":1,"a":1}\r\n${LINE}`],
      [{ [PATH]: '' }, LINE],
      [{}, LINE],
    ] as const) {
      const files = new MemoryFiles(initial);
      await appendJsonlLines(files, PATH, LINE);
      assert.equal(files.get(PATH), after);
    }
    const untouched = new MemoryFiles({ [PATH]: '{"v":1,"to' });
    await appendJsonlLines(untouched, PATH, '');
    assert.equal(untouched.get(PATH), '{"v":1,"to');
    const missing = new MemoryFiles();
    await appendJsonlLines(missing, PATH, '');
    assert.equal(missing.get(PATH), undefined);
  });
});

describe('parseJsonl', () => {
  it('reads objects with their line numbers and versions, skipping blank lines', () => {
    const parse = parseJsonl('{"a":1}\n\n{"v":1,"b":2}\r\n');
    assert.deepEqual(
      parse.records.map((record) => [record.lineNumber, record.version, record.raw]),
      [
        [1, 0, '{"a":1}'],
        [3, 1, '{"v":1,"b":2}'],
      ],
    );
    assert.equal(parse.unreadable, 0);
  });

  it('counts damaged lines, non-objects and invalid versions without throwing', () => {
    const parse = parseJsonl('{"a":1}\n{"torn\n[1,2]\n"text"\n{"v":-1}\n{"v":"2"}\n{"v":1.5}\n');
    assert.equal(parse.records.length, 1);
    assert.equal(parse.unreadable, 6);
  });

  it('reads an empty log', () => {
    assert.deepEqual(parseJsonl(''), { records: [], unreadable: 0 });
  });
});

describe('recordVersion', () => {
  it('treats a missing version as 0', () => {
    assert.equal(recordVersion({}), 0);
    assert.equal(recordVersion({ v: 3 }), 3);
    assert.equal(recordVersion({ v: null }), undefined);
  });
});

describe('toJsonlLine', () => {
  it('writes one line even when a value holds newlines', () => {
    const line = toJsonlLine({ note: 'one\ntwo' });
    assert.equal(line.split('\n').length, 2);
    assert.equal(parseJsonl(line).records[0]?.record['note'], 'one\ntwo');
  });
});

describe('assertWritable', () => {
  it('allows writing beside older and equal versions', () => {
    assert.doesNotThrow(() => assertWritable('log', parseJsonl('{"a":1}\n{"v":1}\n'), 1));
  });

  it('refuses writing beside a newer version', () => {
    assert.throws(
      () => assertWritable('log', parseJsonl('{"v":2}\n'), 1),
      (error: unknown) => error instanceof NewerDataError && error.found === 2 && error.known === 1,
    );
  });
});

describe('writableObject', () => {
  it('returns the record of an older or equal format, and nothing for a missing or damaged file', () => {
    assert.deepEqual(writableObject('file', '{"v":1,"a":2}\n', 1), { v: 1, a: 2 });
    assert.deepEqual(writableObject('file', '{"a":2}', 1), { a: 2 });
    assert.equal(writableObject('file', undefined, 1), undefined);
    assert.equal(writableObject('file', '{"torn', 1), undefined);
  });

  it('refuses a file in a newer format', () => {
    assert.throws(
      () => writableObject('file', '{"v":2}', 1),
      (error: unknown) => error instanceof NewerDataError && error.file === 'file' && error.found === 2 && error.known === 1,
    );
  });

  it('names /reload-plugins, since a newer install than the tab loaded wrote the file (T789)', () => {
    assert.equal(
      new NewerDataError('file', 2, 1).message,
      'file holds format v2 records; this version writes v1. A newer teamrig wrote them: reload the plugins in your session to load the installed one, or update teamrig before writing.',
    );
  });
});
