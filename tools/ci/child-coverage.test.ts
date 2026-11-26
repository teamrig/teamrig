import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COVERAGE_FILE, childFolder, isWhole, processDeps, routeChildCoverage, sweepChildCoverage } from './child-coverage.ts';

const WHOLE = '{"result":[]}';
const CUT = '{"result":[';

let base = '';

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'teamrig-child-coverage-'));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('COVERAGE_FILE', () => {
  it('matches the names V8 gives coverage files and nothing else', () => {
    assert.ok(COVERAGE_FILE.test('coverage-12-1700000000000-3.json'));
    assert.ok(!COVERAGE_FILE.test('children-12'));
    assert.ok(!COVERAGE_FILE.test('coverage-12-170000000000-3.json'));
    assert.ok(!COVERAGE_FILE.test('coverage-12-1700000000000-3.json.tmp'));
  });
});

describe('isWhole', () => {
  it('reads parsed JSON as whole and JSON cut partway through as not', () => {
    assert.equal(isWhole(WHOLE), true);
    assert.equal(isWhole(CUT), false);
    assert.equal(isWhole(''), false);
  });
});

describe('sweepChildCoverage', () => {
  it('moves whole coverage files, drops cut ones, leaves other names behind and removes the folder', () => {
    const from = join(base, 'children-7');
    mkdirSync(from);
    writeFileSync(join(from, 'coverage-1-1700000000000-1.json'), WHOLE);
    writeFileSync(join(from, 'coverage-2-1700000000000-1.json'), CUT);
    writeFileSync(join(from, 'notes.txt'), 'x');
    const dropped = sweepChildCoverage(from, base);
    assert.deepEqual(dropped, ['coverage-2-1700000000000-1.json']);
    assert.deepEqual(readdirSync(base), ['coverage-1-1700000000000-1.json']);
    assert.equal(readFileSync(join(base, 'coverage-1-1700000000000-1.json'), 'utf8'), WHOLE);
  });

  it('drops a coverage name it cannot read as a file, such as a folder', () => {
    const from = join(base, 'children-7');
    mkdirSync(join(from, 'coverage-3-1700000000000-1.json'), { recursive: true });
    assert.deepEqual(sweepChildCoverage(from, base), ['coverage-3-1700000000000-1.json']);
  });

  it('drops nothing when the folder is gone', () => {
    assert.deepEqual(sweepChildCoverage(join(base, 'missing'), base), []);
  });
});

describe('processDeps', () => {
  it('reads the env, pid and test file of a process, hooks its exit and writes its warnings to stderr', () => {
    const exits: (() => void)[] = [];
    const written: string[] = [];
    const env: NodeJS.ProcessEnv = { A: '1' };
    const deps = processDeps({
      env,
      pid: 9,
      argv: ['node', 'src/a.test.ts'],
      on: (_event, listener) => exits.push(listener),
      stderr: { write: (text) => written.push(text) },
    });
    assert.equal(deps.env, env);
    assert.equal(deps.pid, 9);
    assert.equal(deps.file, 'src/a.test.ts');
    let ran = false;
    deps.onExit(() => {
      ran = true;
    });
    exits[0]?.();
    assert.equal(ran, true);
    deps.warn('a line');
    assert.deepEqual(written, ['a line\n']);
  });

  it('names no file for a process run with no script', () => {
    const deps = processDeps({ env: {}, pid: 1, argv: ['node'], on: () => undefined, stderr: { write: () => true } });
    assert.equal(deps.file, '(no file)');
  });
});

describe('routeChildCoverage', () => {
  function route(env: NodeJS.ProcessEnv): { readonly exits: (() => void)[]; readonly lines: string[] } {
    const exits: (() => void)[] = [];
    const lines: string[] = [];
    routeChildCoverage({ env, pid: 42, file: 'src/a.test.ts', onExit: (listener) => exits.push(listener), warn: (line) => lines.push(line) });
    return { exits, lines };
  }

  it('in a test-file process, points children at a folder of their own and moves their whole files in at exit', () => {
    const env: NodeJS.ProcessEnv = { NODE_V8_COVERAGE: base, NODE_TEST_CONTEXT: 'child-v8' };
    const { exits, lines } = route(env);
    const folder = childFolder(base, 42);
    assert.equal(env['NODE_V8_COVERAGE'], folder);
    assert.ok(existsSync(folder));
    writeFileSync(join(folder, 'coverage-5-1700000000000-1.json'), WHOLE);
    writeFileSync(join(folder, 'coverage-6-1700000000000-1.json'), CUT);
    assert.equal(exits.length, 1);
    exits[0]?.();
    assert.deepEqual(readdirSync(base), ['coverage-5-1700000000000-1.json']);
    assert.deepEqual(lines, [
      'coverage: dropped coverage-6-1700000000000-1.json, a coverage file a child of src/a.test.ts left cut short (such as one killed while it exited)',
    ]);
  });

  it('leaves the runner process and a process outside a coverage run alone', () => {
    for (const env of [{ NODE_V8_COVERAGE: base }, { NODE_TEST_CONTEXT: 'child-v8' }, { NODE_V8_COVERAGE: '', NODE_TEST_CONTEXT: 'child-v8' }]) {
      const before = { ...env };
      const { exits } = route(env);
      assert.deepEqual(env, before);
      assert.equal(exits.length, 0);
    }
    assert.deepEqual(readdirSync(base), []);
  });
});
