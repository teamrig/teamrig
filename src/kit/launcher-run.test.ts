import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { isRunBy, LIST_PATH, textHash } from './launcher.ts';

/**
 * The launcher run as Node runs it from a hook line: its own file in `<kit home>/bin`, a version in `versions/`. Node
 * strips the types of a `.mts` copy, so the spec runs the source the build compiles.
 */

const VERSION = '1.2.3';
let kit = '';

/** The entry script each case installs: what it does with the words it gets. */
const ENTRY = `const words = process.argv.slice(2);
if (words.includes('crash')) process.exit(1);
if (words.includes('throw')) setTimeout(() => { throw new Error('late'); }, 0);
process.stdout.write(JSON.stringify(words));
`;

async function install(entry: string): Promise<void> {
  const folder = join(kit, 'versions', VERSION);
  await rm(join(kit, 'versions'), { recursive: true, force: true });
  await mkdir(join(folder, 'dist', 'cli'), { recursive: true });
  await writeFile(join(folder, 'dist', 'cli', 'main.js'), entry);
  const list = `${JSON.stringify({ files: { 'dist/cli/main.js': textHash(entry) } })}\n`;
  await writeFile(join(folder, LIST_PATH), list);
  await writeFile(join(kit, 'current'), `${VERSION}\n`);
  await writeFile(join(kit, 'current.json'), JSON.stringify({ format: 1, version: VERSION, listHash: textHash(list) }));
}

function run(...words: string[]): { code: number | null; out: string; err: string } {
  const done = spawnSync(process.execPath, [join(kit, 'bin', 'teamrig.mts'), ...words], { encoding: 'utf8', timeout: 30_000 });
  return { code: done.status, out: done.stdout, err: done.stderr };
}

describe('the launcher, run by Node', () => {
  before(async () => {
    kit = await mkdtemp(join(tmpdir(), 'teamrig-launcher-'));
    await mkdir(join(kit, 'bin'));
    await writeFile(join(kit, 'bin', 'teamrig.mts'), await readFile(new URL('./launcher.ts', import.meta.url), 'utf8'));
    await writeFile(join(kit, 'package.json'), '{"type":"module"}\n');
  });
  after(async () => {
    await rm(kit, { recursive: true, force: true });
  });

  it('runs the current version with the CLI words, its own flags taken off', async () => {
    await install(ENTRY);
    const done = run('--launcher-event', 'PreToolUse', 'hook', 'exec-guard', '--host', 'codex-cli');
    assert.deepEqual([done.code, done.out], [0, JSON.stringify(['hook', 'exec-guard', '--host', 'codex-cli'])], done.err);
  });

  it('blocks a guard event on a changed file and lets a context event go on', async () => {
    await install(ENTRY);
    await writeFile(join(kit, 'versions', VERSION, 'dist', 'cli', 'main.js'), `${ENTRY}// changed\n`);
    const guard = run('--launcher-event', 'PreToolUse', 'hook', 'exec-guard');
    assert.equal(guard.code, 2);
    assert.match(guard.err, /teamrig files changed: dist\/cli\/main\.js/);
    assert.equal(guard.out, '');
    assert.equal(run('--launcher-event', 'SessionStart', 'hook', 'session-start').code, 0);
    assert.equal(run('list').code, 1);
  });

  it('turns a hook run’s crash into the event’s exit', async () => {
    await install(ENTRY);
    assert.equal(run('--launcher-event', 'PreToolUse', 'hook', 'crash').code, 2);
    assert.equal(run('--launcher-event', 'Stop', 'hook', 'crash').code, 0);
    assert.equal(run('--launcher-event', 'PreToolUse', 'hook', 'throw').code, 2);
    assert.equal(run('list', 'crash').code, 1);
  });
});

describe('isRunBy', () => {
  it('matches the script Node runs by its real path only', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'teamrig-run-by-'));
    try {
      const script = join(folder, 'a.mjs');
      await writeFile(script, '');
      await writeFile(join(folder, 'b.mjs'), '');
      assert.equal(isRunBy(script, join(dirname(script), '.', 'a.mjs')), true);
      assert.equal(isRunBy(script, join(folder, 'b.mjs')), false);
      assert.equal(isRunBy(script, join(folder, 'missing.mjs')), false);
      assert.equal(isRunBy(script, undefined), false);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
