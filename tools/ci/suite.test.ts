import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hangFinding } from './suite-run.ts';
import { suiteExit, suiteOptions, suiteRunArgs } from './suite.ts';

/** The `test` script of package.json, the line `npm test` runs. */
function npmTestLine(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const scripts = typeof manifest === 'object' && manifest !== null && 'scripts' in manifest ? manifest.scripts : undefined;
  const test = typeof scripts === 'object' && scripts !== null && 'test' in scripts ? scripts.test : undefined;
  assert.ok(typeof test === 'string', 'package.json has a test script');
  return test;
}

/** Arguments as npm test's line writes them: file patterns quoted, so the shell leaves the globs to node. */
function asLine(args: readonly string[]): string {
  return ['node', ...args.map((arg) => (arg.includes('*') ? `"${arg}"` : arg))].join(' ');
}

describe('suiteRunArgs', () => {
  it("runs npm test's own suite, with only the worker count added (T5027)", () => {
    const args = suiteRunArgs(3, undefined);
    assert.equal(asLine(args.filter((arg) => arg !== '--test-concurrency=3')), npmTestLine());
    assert.equal(args[1], '--test-concurrency=3');
  });

  it('puts the shard flag before the file patterns, as node ignores one after them (T5030)', () => {
    const args = suiteRunArgs(4, '2/2');
    const flag = args.indexOf('--test-shard=2/2');
    assert.ok(flag > 0 && flag < args.indexOf('tools/**/*.test.ts'), args.join(' '));
    assert.equal(asLine(args.filter((arg) => arg !== '--test-shard=2/2' && arg !== '--test-concurrency=4')), npmTestLine());
  });
});

describe('suiteExit', () => {
  it("exits with the suite's own status, printing nothing", () => {
    assert.deepEqual(suiteExit({ kind: 'exited', status: 0 }, '22.20.0'), { code: 0, line: undefined });
    assert.deepEqual(suiteExit({ kind: 'exited', status: 1 }, '22.20.0'), { code: 1, line: undefined });
  });

  it('fails a suite stopped as hung with the hang finding, and one ended by a signal', () => {
    assert.deepEqual(suiteExit({ kind: 'idle', silentMs: 300_000 }, '22.20.0'), { code: 1, line: hangFinding(300_000, '22.20.0') });
    assert.deepEqual(suiteExit({ kind: 'exited', status: null }, '22.20.0'), { code: 1, line: 'the test run ended on a signal, with no exit status' });
  });
});

describe('suiteOptions', () => {
  it('reads no options as the whole suite, and --shard as one shard of it', () => {
    assert.deepEqual(suiteOptions([]), { kind: 'options', shard: undefined });
    assert.deepEqual(suiteOptions(['--shard', '1/2']), { kind: 'options', shard: '1/2' });
  });

  it('refuses an unknown option, a shard given twice and a shard outside 1 to n', () => {
    assert.deepEqual(suiteOptions(['--alone']), { kind: 'invalid', problem: 'unknown option --alone' });
    assert.deepEqual(suiteOptions(['--shard', '1/2', '--shard', '2/2']), { kind: 'invalid', problem: '--shard is given twice' });
    for (const value of ['3/2', '0/2', '1/0', 'a/b', '1-2']) {
      assert.deepEqual(suiteOptions(['--shard', value]), { kind: 'invalid', problem: `--shard needs <i>/<n> with 1 <= i <= n, not "${value}"` });
    }
    assert.deepEqual(suiteOptions(['--shard']), { kind: 'invalid', problem: '--shard needs <i>/<n> with 1 <= i <= n, not ""' });
  });
});
