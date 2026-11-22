import { relative } from 'node:path';
import type { TestEvent } from 'node:test/reporters';

/** How many of the slowest files and tests the report names, enough to pick the next ones to speed up (T5027). */
export const SLOWEST_LIMIT = 30;

/** One finished test or suite, as the runner reports it. */
export interface Finished {
  readonly file: string | undefined;
  readonly name: string;
  readonly nesting: number;
  readonly durationMs: number;
  readonly suite: boolean;
}

/** A finished test or suite from a runner event, or undefined for any other event. */
export function finishedOf(event: TestEvent): Finished | undefined {
  if (event.type !== 'test:pass' && event.type !== 'test:fail') return undefined;
  const { data } = event;
  return { file: data.file, name: data.name, nesting: data.nesting, durationMs: data.details.duration_ms, suite: data.details.type === 'suite' };
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The report: each file's time (its top-level tests and suites summed, one file running its tests one after another,
 * so the slowest file is a floor under the suite's wall time), then each test's own, slowest first. Paths are relative
 * to `root`, so a log names no machine's folders.
 */
export function slowestReport(finished: readonly Finished[], root: string, limit: number = SLOWEST_LIMIT): string {
  const where = (file: string | undefined): string => (file === undefined ? '(no file)' : relative(root, file).replaceAll('\\', '/'));
  const perFile = new Map<string, number>();
  for (const entry of finished) {
    if (entry.nesting !== 0) continue;
    const file = where(entry.file);
    perFile.set(file, (perFile.get(file) ?? 0) + entry.durationMs);
  }
  const files = [...perFile].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const tests = finished
    .filter((entry) => !entry.suite)
    .toSorted((a, b) => b.durationMs - a.durationMs)
    .slice(0, limit);
  const total = [...perFile.values()].reduce((sum, ms) => sum + ms, 0);
  return [
    `slowest ${files.length} of ${perFile.size} test files (${seconds(total)} of test time summed):`,
    ...files.map(([file, ms], index) => `  ${index + 1}. ${seconds(ms)}  ${file}`),
    `slowest ${tests.length} tests:`,
    ...tests.map((entry, index) => `  ${index + 1}. ${seconds(entry.durationMs)}  ${where(entry.file)} > ${entry.name}`),
    '',
  ].join('\n');
}

/** A node:test reporter that prints nothing until the run ends, then the slowest files and tests. */
export default async function* slowestReporter(source: AsyncIterable<TestEvent>): AsyncGenerator<string, void> {
  const finished: Finished[] = [];
  for await (const event of source) {
    const entry = finishedOf(event);
    if (entry !== undefined) finished.push(entry);
  }
  yield slowestReport(finished, process.cwd());
}
