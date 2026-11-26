import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suiteEnv } from './coverage.ts';

const CLI = fileURLToPath(new URL('./suite-cli.ts', import.meta.url));

const POLICY = { total: { lines: 0, branches: 0, functions: 0 }, perFile: { lines: 0, branches: 0, functions: 0 }, testSupport: [] };

/** A reporter that reads the run and prints nothing, standing in for the repo's slowest-files reporter. */
const QUIET_REPORTER = 'export default async function* quiet(source: AsyncIterable<unknown>): AsyncGenerator<string> {\n  for await (const event of source) void event;\n}\n';

interface SuiteRun {
  readonly status: number | null;
  readonly output: string;
}

/** Runs the CLI with `--root` on a throwaway repo holding the given files, from a folder outside it. */
function suite(files: Readonly<Record<string, string>>, options: readonly string[] = []): SuiteRun {
  const base = mkdtempSync(join(tmpdir(), 'teamrig-suite-cli-'));
  try {
    const root = join(base, 'repo');
    const all = { 'tools/ci/coverage.json': JSON.stringify(POLICY), 'tools/ci/slowest-reporter.ts': QUIET_REPORTER, ...files };
    for (const [path, text] of Object.entries(all)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const run = spawnSync(process.execPath, [CLI, '--root', root, ...options], { cwd: base, encoding: 'utf8', env: suiteEnv(process.env) });
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

const PASSING = "import { it } from 'node:test';\nit('passes', () => {});\n";
const FAILING = "import { it } from 'node:test';\nimport assert from 'node:assert/strict';\nit('fails', () => assert.equal(1, 2));\n";

describe('suite-cli', () => {
  it('runs the suite a file a core and exits clean when every test passes (T5027)', () => {
    const run = suite({ 'tools/a.test.ts': PASSING });
    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /suite: \d+ test file\(s\) at once\n/);
    assert.match(run.output, /✔ passes/);
  });

  it("exits with the suite's failing status when a test fails", () => {
    const run = suite({ 'tools/a.test.ts': PASSING, 'tools/b.test.ts': FAILING });
    assert.equal(run.status, 1, run.output);
    assert.match(run.output, /✖ fails/);
  });

  it('runs only its shard of the suite', () => {
    const run = suite({ 'tools/a.test.ts': PASSING, 'tools/b.test.ts': FAILING }, ['--shard', '1/2']);
    assert.match(run.output, /, shard 1\/2\n/);
    assert.equal(run.output.includes('✔ passes') && run.output.includes('✖ fails'), false, 'one shard runs one of the two files');
  });

  it('refuses an unknown option with its usage', () => {
    const run = suite({ 'tools/a.test.ts': PASSING }, ['--alone']);
    assert.equal(run.status, 2, run.output);
    assert.match(run.output, /suite: unknown option --alone \(usage: suite-cli\.ts/);
  });

  it('refuses a broken coverage policy, whose idle limit it reads', () => {
    const run = suite({ 'tools/a.test.ts': PASSING, 'tools/ci/coverage.json': '{"total":{}}' });
    assert.equal(run.status, 2, run.output);
    assert.match(run.output, /suite: tools\/ci\/coverage\.json: /);
  });
});
