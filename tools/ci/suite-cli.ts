import { readFileSync, realpathSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { EXIT_USAGE } from '../lib/exit.ts';
import { takeRoot } from '../lib/repo-root.ts';
import { runMain } from '../lib/run-main.ts';
import { parsePolicy, POLICY_FILE, suiteEnv, suiteWorkers } from './coverage.ts';
import { runSuite } from './suite-run.ts';
import { SUITE_USAGE, suiteExit, suiteOptions, suiteRunArgs } from './suite.ts';

/**
 * Runs npm test's suite (or one `--shard <i>/<n>` of it) on a CI runner, which has its VM to itself: a test file a
 * core at once (suiteWorkers 'alone'), where `node --test` alone keeps cores - 1 and left a 3-core macOS runner running
 * two (T5027). Exits with the suite's status; a suite that prints nothing for the coverage policy's suiteIdleSeconds
 * is stopped with its tree and fails as hung, as the coverage gate does.
 */
async function main(args: readonly string[]): Promise<number> {
  const { root: given, rest } = takeRoot(args);
  const options = suiteOptions(rest);
  if (options.kind === 'invalid') throw new Error(`${options.problem} (usage: ${SUITE_USAGE})`);
  const root = realpathSync(given);
  const parsed = parsePolicy(JSON.parse(readFileSync(join(root, POLICY_FILE), 'utf8')));
  if (parsed.kind === 'invalid') {
    console.log(`suite: ${POLICY_FILE}: ${parsed.problem}`);
    return EXIT_USAGE;
  }
  const workers = suiteWorkers(availableParallelism(), 'alone');
  console.log(`suite: ${workers} test file(s) at once${options.shard === undefined ? '' : `, shard ${options.shard}`}`);
  const end = await runSuite({ program: process.execPath, args: suiteRunArgs(workers, options.shard), cwd: root, env: suiteEnv(process.env), idleMs: parsed.policy.suiteIdleSeconds * 1000 });
  const exit = suiteExit(end, process.versions.node);
  if (exit.line !== undefined) console.log(`suite: ${exit.line}`);
  return exit.code;
}

process.exitCode = await runMain('suite', () => main(process.argv.slice(2)), (line) => console.error(line));
