import { EXIT_FINDINGS } from '../lib/exit.ts';
import { TEST_FILES } from './coverage.ts';
import { hangFinding, type SuiteEnd } from './suite-run.ts';

/** How the suite CLI exits: the suite's status, or a failure with its line for a suite stopped as hung or by a signal. */
export interface SuiteExit {
  readonly code: number;
  readonly line: string | undefined;
}

/** The CLI's exit for how the suite ended, naming Node's runner bug for a hung suite on a Node that has it. */
export function suiteExit(end: SuiteEnd, nodeVersion: string): SuiteExit {
  if (end.kind === 'idle') return { code: EXIT_FINDINGS, line: hangFinding(end.silentMs, nodeVersion) };
  if (end.status === null) return { code: EXIT_FINDINGS, line: 'the test run ended on a signal, with no exit status' };
  return { code: end.status, line: undefined };
}

/** The reporter npm test ends its output with, named from the repo root the suite runs in (T5027). */
export const SLOWEST_REPORTER_PATH = './tools/ci/slowest-reporter.ts';

export const SUITE_USAGE = 'suite-cli.ts [--root <repo>] [--shard <i>/<n>]';

/** The suite CLI's options, after `--root`: the shard of the suite a CI leg runs, if any. */
export type SuiteOptions = { readonly kind: 'options'; readonly shard: string | undefined } | { readonly kind: 'invalid'; readonly problem: string };

const SHARD = /^([1-9]\d*)\/([1-9]\d*)$/;

/** Reads the options left after `--root`: `--shard <i>/<n>`, with 1 <= i <= n, at most once. */
export function suiteOptions(rest: readonly string[]): SuiteOptions {
  let shard: string | undefined;
  for (let at = 0; at < rest.length; at += 1) {
    const option = rest[at];
    if (option !== '--shard') return { kind: 'invalid', problem: `unknown option ${option ?? ''}` };
    if (shard !== undefined) return { kind: 'invalid', problem: '--shard is given twice' };
    const value = rest[at + 1] ?? '';
    const parts = SHARD.exec(value);
    if (parts === null || Number(parts[1]) > Number(parts[2])) return { kind: 'invalid', problem: `--shard needs <i>/<n> with 1 <= i <= n, not "${value}"` };
    shard = value;
    at += 1;
  }
  return { kind: 'options', shard };
}

/**
 * The `node` arguments of npm test's suite with `workers` test files at once and, on a shard leg, only its shard. The
 * shard flag goes before the file patterns, as node ignores a --test-shard after them (T5030). Without the two flags it
 * is npm test's own line, which tools/ci/suite.test.ts holds equal.
 */
export function suiteRunArgs(workers: number, shard: string | undefined): string[] {
  return [
    '--test',
    `--test-concurrency=${workers}`,
    ...(shard === undefined ? [] : [`--test-shard=${shard}`]),
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    `--test-reporter=${SLOWEST_REPORTER_PATH}`,
    '--test-reporter-destination=stdout',
    ...TEST_FILES,
  ];
}
