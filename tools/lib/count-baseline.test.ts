import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type GitRunner, baselineAt, baselineText, compareCounts, heldBaseline, parseBaseline, readBaseline, takeBase } from './count-baseline.ts';

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

describe('heldBaseline', () => {
  it("holds each key to the lower of the change's count and the base's, a key one side lacks to the other's", () => {
    const own = new Map([['raised', 5], ['lowered', 1], ['new', 2]]);
    const base = new Map([['raised', 3], ['lowered', 4], ['dropped', 6]]);
    assert.deepEqual(
      [...heldBaseline(own, base)].sort(([a], [b]) => (a < b ? -1 : 1)),
      [['dropped', 6], ['lowered', 1], ['new', 2], ['raised', 3]],
    );
  });
});

describe('takeBase', () => {
  it('takes --base and its commit out, keeping the rest in order', () => {
    assert.deepEqual(takeBase(['--list']), { base: undefined, rest: ['--list'] });
    assert.deepEqual(takeBase(['--list', '--base', 'abc123', '--write']), { base: 'abc123', rest: ['--list', '--write'] });
  });

  it('refuses a --base with no commit, an option in its place, or a second --base', () => {
    assert.throws(() => takeBase(['--base']), /--base needs a commit/);
    assert.throws(() => takeBase(['--base', '--list']), /--base needs a commit/);
    assert.throws(() => takeBase(['--base', 'a', '--base', 'b']), /--base is given twice/);
  });
});

describe('baselineAt', () => {
  /** A git that answers each command from `answers` by its first word, recording every call, and fails the rest. */
  const fakeGit = (answers: Readonly<Record<string, string>>): { readonly git: GitRunner; readonly calls: string[][] } => {
    const calls: string[][] = [];
    const git: GitRunner = (args) => {
      calls.push([...args]);
      const answer = answers[args[0] ?? ''];
      if (answer === undefined) throw new Error(`git ${args.join(' ')} failed`);
      return answer;
    };
    return { git, calls };
  };

  it("reads the file's counts as the commit holds it", () => {
    const { git, calls } = fakeGit({ 'rev-parse': 'abc\n', 'ls-tree': 'tools/ci/b.json\n', show: baselineText('c', 'rules', new Map([['a', 2]])) });
    assert.deepEqual([...baselineAt(git, 'abc', 'tools/ci/b.json', 'rules')], [['a', 2]]);
    assert.deepEqual(calls, [
      ['rev-parse', '--verify', '--quiet', 'abc^{commit}'],
      ['ls-tree', '--name-only', 'abc', '--', 'tools/ci/b.json'],
      ['show', 'abc:tools/ci/b.json'],
    ]);
  });

  it('gives no counts when the commit has no such file', () => {
    const { git, calls } = fakeGit({ 'rev-parse': 'abc\n', 'ls-tree': '' });
    assert.deepEqual([...baselineAt(git, 'abc', 'tools/ci/b.json', 'rules')], []);
    assert.equal(calls.length, 2);
  });

  it('throws when the rev names no commit, rather than holding the counts to nothing', () => {
    const { git } = fakeGit({});
    assert.throws(() => baselineAt(git, 'gone', 'tools/ci/b.json', 'rules'), /--base gone names no commit in this repo/);
  });
});
