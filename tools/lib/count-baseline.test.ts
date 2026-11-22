import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baselineText, compareCounts, parseBaseline, readBaseline } from './count-baseline.ts';

describe('compareCounts', () => {
  it('sorts the counts into rose, fell and gone, a key the baseline lacks having 0', () => {
    const counts = new Map([['a', 3], ['b', 1], ['c', 2], ['d', 0]]);
    const baseline = new Map([['a', 3], ['b', 4], ['z', 1]]);
    assert.deepEqual(compareCounts(counts, baseline), {
      rose: [{ key: 'c', count: 2, baseline: 0 }],
      fell: [{ key: 'b', count: 1, baseline: 4 }],
      gone: ['z'],
    });
  });
});

describe('the baseline file', () => {
  it('reads back what it writes under its field, keys sorted, the comment first', () => {
    const text = baselineText('what it holds', 'rules', new Map([['b', 2], ['a', 0]]));
    assert.match(text, /^\{\n {2}"\$comment": "what it holds",\n {2}"rules": \{\n {4}"a": 0,\n {4}"b": 2\n/);
    assert.ok(text.endsWith('}\n'));
    assert.deepEqual([...parseBaseline(JSON.parse(text), 'rules')], [['a', 0], ['b', 2]]);
  });

  it('refuses a file without the field as an object or with a count that is not a whole number', () => {
    assert.throws(() => parseBaseline([], 'skills'), /needs a "skills" object/);
    assert.throws(() => parseBaseline({ skills: [] }, 'skills'), /needs a "skills" object/);
    assert.throws(() => parseBaseline({ rules: {} }, 'skills'), /needs a "skills" object/);
    assert.throws(() => parseBaseline({ skills: { a: '1' } }, 'skills'), /count of a is not a whole number/);
    assert.throws(() => parseBaseline({ skills: { a: 1.5 } }, 'skills'), /count of a is not a whole number/);
    assert.throws(() => parseBaseline({ skills: { a: -1 } }, 'skills'), /count of a is not a whole number/);
  });

  it('reads a file back by its path, and no counts when there is no file yet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'count-baseline-'));
    try {
      const file = join(dir, 'baseline.json');
      assert.deepEqual([...readBaseline(file, 'rules')], []);
      writeFileSync(file, baselineText('what it holds', 'rules', new Map([['a', 1]])));
      assert.deepEqual([...readBaseline(file, 'rules')], [['a', 1]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
