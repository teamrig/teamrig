import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { isRunBy, LIST_PATH, nodeLauncherFiles, processLauncher, textHash } from './launcher.ts';

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

describe('nodeLauncherFiles', () => {
  let folder = '';
  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'teamrig-launcher-files-'));
    await writeFile(join(folder, 'a.txt'), 'text a');
    await mkdir(join(folder, 'sub'));
  });
  after(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('reads a file and its real path, and gives undefined for a missing one', async () => {
    assert.equal(await nodeLauncherFiles.read(join(folder, 'a.txt')), 'text a');
    assert.equal(await nodeLauncherFiles.read(join(folder, 'missing')), undefined);
    assert.equal(await nodeLauncherFiles.realPath(join(folder, 'sub', '..', 'a.txt')), await realpath(join(folder, 'a.txt')));
    assert.equal(await nodeLauncherFiles.realPath(join(folder, 'missing')), undefined);
  });

  it('lists a folder’s files and folders, and gives undefined for a missing one', async () => {
    const entries = await nodeLauncherFiles.list(folder);
    assert.deepEqual(
      [...(entries ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
      [
        { name: 'a.txt', kind: 'file' },
        { name: 'sub', kind: 'folder' },
      ],
    );
    assert.equal(await nodeLauncherFiles.list(join(folder, 'missing')), undefined);
  });

  it('stats a file only: a folder and a missing path give undefined', async () => {
    const found = await stat(join(folder, 'a.txt'));
    assert.deepEqual(await nodeLauncherFiles.stat(join(folder, 'a.txt')), { size: found.size, mtimeMs: found.mtimeMs, ino: found.ino });
    assert.equal(await nodeLauncherFiles.stat(join(folder, 'sub')), undefined);
    assert.equal(await nodeLauncherFiles.stat(join(folder, 'missing')), undefined);
  });

  it('replaces a file whole and leaves no temp file', async () => {
    await nodeLauncherFiles.replace(join(folder, 'a.txt'), 'text b');
    assert.equal(await readFile(join(folder, 'a.txt'), 'utf8'), 'text b');
    assert.deepEqual((await readdir(folder)).sort(), ['a.txt', 'sub']);
  });
});

describe('processLauncher', () => {
  let kitHome = '';
  let script = '';
  const SCRIPT_TEXT = '// the launcher\n';
  before(async () => {
    kitHome = await mkdtemp(join(tmpdir(), 'teamrig-process-launcher-'));
    await mkdir(join(kitHome, 'bin'));
    script = join(kitHome, 'bin', 'teamrig.mjs');
    await writeFile(script, SCRIPT_TEXT);
  });
  after(async () => {
    await rm(kitHome, { recursive: true, force: true });
  });

  /** Runs `body` with `process.argv` set to `argv`, then puts it and the exit code back. */
  async function withArgv(argv: readonly string[], body: () => Promise<void>): Promise<void> {
    const saved = process.argv;
    process.argv = [...argv];
    try {
      await body();
    } finally {
      process.argv = saved;
      process.exitCode = undefined;
    }
  }

  it('reads the words after the script, the kit home above bin and the script’s own hash', async () => {
    await withArgv(['node', script, '--launcher-event', 'Stop', 'list'], async () => {
      const host = processLauncher(script);
      assert.deepEqual([host.argv, host.kitHome, host.launcherHash, host.files], [['--launcher-event', 'Stop', 'list'], kitHome, textHash(SCRIPT_TEXT), nodeLauncherFiles]);
    });
  });

  it('runs the entry script with the node word, the entry and the CLI words as its argv', async () => {
    const entry = join(kitHome, 'entry.mjs');
    const seen = join(kitHome, 'seen.json');
    await writeFile(entry, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(seen)}, JSON.stringify(process.argv));\n`);
    await withArgv(['node-word', script, 'list'], async () => {
      await processLauncher(script).run(entry, ['list', '--all']);
      const argv: unknown = JSON.parse(await readFile(seen, 'utf8'));
      assert.deepEqual(argv, ['node-word', entry, 'list', '--all']);
    });
  });

  it('writes errors to stderr and exits through process.exit', async (t) => {
    const written: string[] = [];
    const exits: (number | undefined)[] = [];
    t.mock.method(process.stderr, 'write', (text: string) => written.push(text) > 0);
    t.mock.method(process, 'exit', (code?: number) => {
      exits.push(code);
    });
    await withArgv(['node', script], async () => {
      const host = processLauncher(script);
      host.writeError('teamrig: broken\n');
      host.exit(2);
    });
    t.mock.restoreAll();
    assert.deepEqual([written, exits], [['teamrig: broken\n'], [2]]);
  });

  it('ends a run through the fix it is given, and a crash with exit 1', async (t) => {
    const listeners = new Map<string, (value: unknown) => void>();
    const written: string[] = [];
    const exits: (number | undefined)[] = [];
    t.mock.method(process, 'on', (event: string, listener: (value: unknown) => void) => {
      listeners.set(event, listener);
      return process;
    });
    t.mock.method(process.stderr, 'write', (text: string) => written.push(text) > 0);
    t.mock.method(process, 'exit', (code?: number) => {
      exits.push(code);
    });
    const codes: number[] = [];
    await withArgv(['node', script], async () => {
      processLauncher(script).onEnd((code) => (code === 0 ? 0 : 2));
      assert.deepEqual([...listeners.keys()].sort(), ['exit', 'uncaughtException', 'unhandledRejection']);
      listeners.get('exit')?.(7);
      codes.push(Number(process.exitCode));
      listeners.get('uncaughtException')?.(new Error('late'));
      codes.push(Number(process.exitCode));
      listeners.get('unhandledRejection')?.('plain');
    });
    assert.deepEqual([codes, written, exits], [[2, 1], ['teamrig: late\n', 'teamrig: plain\n'], [undefined, undefined]]);
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
