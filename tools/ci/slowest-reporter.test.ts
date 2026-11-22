import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { TestEvent } from 'node:test/reporters';
import slowestReporter, { finishedOf, slowestReport, SLOWEST_LIMIT, type Finished } from './slowest-reporter.ts';

const ROOT = join('/', 'repo');

function pass(file: string, name: string, nesting: number, ms: number, suite = false): TestEvent {
  return { type: 'test:pass', data: { file, name, nesting, testNumber: 1, details: suite ? { duration_ms: ms, type: 'suite' } : { duration_ms: ms } } };
}

function finished(file: string, name: string, nesting: number, durationMs: number, suite = false): Finished {
  return { file: join(ROOT, file), name, nesting, durationMs, suite };
}

async function* eventsOf(events: readonly TestEvent[]): AsyncGenerator<TestEvent, void> {
  yield* events;
}

describe('slowest reporter (T5027)', () => {
  it('reads a passed or failed test or suite, and nothing from any other event', () => {
    assert.deepEqual(finishedOf(pass(join(ROOT, 'a.test.ts'), 'suite a', 0, 12, true)), finished('a.test.ts', 'suite a', 0, 12, true));
    const failed: TestEvent = { type: 'test:fail', data: { file: join(ROOT, 'b.test.ts'), name: 'breaks', nesting: 1, testNumber: 2, details: { duration_ms: 7, error: Object.assign(new Error('no'), { cause: new Error('why') }) } } };
    assert.deepEqual(finishedOf(failed), finished('b.test.ts', 'breaks', 1, 7));
    assert.equal(finishedOf({ type: 'test:diagnostic', data: { message: 'tests 2', nesting: 0, level: 'info' } }), undefined);
  });

  it("sums each file's top-level tests and suites, ranks the files and the tests apart from suites, slowest first", () => {
    const report = slowestReport(
      [
        finished('fast.test.ts', 'quick', 0, 100),
        finished('slow.test.ts', 'kills', 1, 2_000),
        finished('slow.test.ts', 'suite', 0, 2_500, true),
        finished('slow.test.ts', 'alone', 0, 1_000),
      ],
      ROOT,
    );
    assert.equal(
      report,
      [
        'slowest 2 of 2 test files (3.6 s of test time summed):',
        '  1. 3.5 s  slow.test.ts',
        '  2. 0.1 s  fast.test.ts',
        'slowest 3 tests:',
        '  1. 2.0 s  slow.test.ts > kills',
        '  2. 1.0 s  slow.test.ts > alone',
        '  3. 0.1 s  fast.test.ts > quick',
        '',
      ].join('\n'),
    );
  });

  it('names paths from the root with forward slashes, keeps to the limit, and names a test with no file', () => {
    const report = slowestReport([finished(join('src', 'deep', 'x.test.ts'), 'x', 0, 50), { file: undefined, name: 'repl', nesting: 0, durationMs: 10, suite: false }], ROOT, 1);
    assert.match(report, /^ {2}1\. 0\.1 s {2}src\/deep\/x\.test\.ts$/m);
    assert.doesNotMatch(report, /repl/, 'past the limit');
    assert.match(slowestReport([{ file: undefined, name: 'repl', nesting: 0, durationMs: 10, suite: false }], ROOT), /\(no file\) > repl/);
    assert.equal(SLOWEST_LIMIT, 30);
  });

  it('prints the report once, when the run ends, from the files under the working folder', async () => {
    const printed: string[] = [];
    const events = [pass(join(process.cwd(), 'a.test.ts'), 'one', 0, 1_500), { type: 'test:plan', data: { count: 1, nesting: 0 } } satisfies TestEvent];
    for await (const chunk of slowestReporter(eventsOf(events))) printed.push(chunk);
    assert.equal(printed.length, 1);
    assert.match(printed[0] ?? '', /^ {2}1\. 1\.5 s {2}a\.test\.ts > one$/m);
  });
});
