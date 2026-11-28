import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CheckedBundle } from './bundle.ts';
import { bundleStage, keepManifest, keptManifestPath } from './bundle-stage.ts';
import { sha256Of } from './spawn.ts';

const roots: string[] = [];
const POSIX = process.platform !== 'win32';

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'teamrig-bundle-stage-'));
  roots.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

const HOST = new TextEncoder().encode('export {};\n');
const WIRE = new TextEncoder().encode('export const wire = 1;\n');
const MANIFEST = new TextEncoder().encode('{"teamrigHost":1}');
const BUNDLE: CheckedBundle = {
  manifest: { name: 'h', version: '1', runtime: 'node', entry: 'dist/host.mjs', files: new Map([['dist/host.mjs', sha256Of(HOST)], ['dist/lib/wire.mjs', sha256Of(WIRE)]]) },
  manifestBytes: MANIFEST,
  sha256: sha256Of(MANIFEST),
  files: new Map([['dist/host.mjs', HOST], ['dist/lib/wire.mjs', WIRE]]),
};

async function listing(folder: string): Promise<string[]> {
  return (await readdir(folder, { recursive: true })).map((path) => path.replaceAll('\\', '/')).sort();
}

const WHOLE = ['dist', 'dist/host.mjs', 'dist/lib', 'dist/lib/wire.mjs'];
/** What a fresh copy's root and `WHOLE` are: a folder or a plain file, no link, with its mode. */
const FRESH = ['folder 700', 'folder 700', 'file 700', 'folder 700', 'file 600'];

/** The kind and, on POSIX, the mode of the copy's root and each path of `WHOLE`, a link seen as a link. */
async function kinds(folder: string): Promise<string[]> {
  return Promise.all(
    ['', ...WHOLE].map(async (path) => {
      const stats = await lstat(join(folder, path));
      const kind = stats.isSymbolicLink() ? 'link' : stats.isDirectory() ? 'folder' : 'file';
      return POSIX ? `${kind} ${(stats.mode & 0o777).toString(8)}` : kind;
    }),
  );
}

function freshKinds(): string[] {
  return POSIX ? FRESH : FRESH.map((kind) => kind.split(' ')[0] ?? kind);
}

/** Writes a file the copy's own mode check passes, so only its path or its bytes can give it away. */
function privateFile(path: string, text: string): Promise<void> {
  return writeFile(path, text, { mode: 0o600 });
}

/** Stages, lets `spoil` change the copy, stages again, and asserts the copy is whole and fresh. */
async function restaged(spoil: (folder: string) => Promise<void>): Promise<void> {
  const dir = await freshDir();
  const stage = bundleStage(dir, 'p1');
  const folder = await stage(BUNDLE);
  await spoil(folder);
  assert.equal(await stage(BUNDLE), folder);
  assert.deepEqual(await listing(folder), WHOLE);
  assert.deepEqual(await kinds(folder), freshKinds());
  assert.deepEqual(new Uint8Array(await readFile(join(folder, 'dist', 'host.mjs'))), HOST);
  assert.deepEqual(new Uint8Array(await readFile(join(folder, 'dist', 'lib', 'wire.mjs'))), WIRE);
  assert.deepEqual((await readdir(dir)).sort(), [BUNDLE.sha256, `${BUNDLE.sha256}.json`]);
}

describe('bundleStage', () => {
  it('copies exactly the listed files to <dir>/<manifest sha256>, keeps the manifest beside it and leaves nothing else', async () => {
    const dir = await freshDir();
    const folder = await bundleStage(join(dir, 'hosts'), 'p1')(BUNDLE);
    assert.equal(folder, join(dir, 'hosts', BUNDLE.sha256));
    assert.deepEqual(await listing(folder), WHOLE);
    assert.deepEqual((await readdir(join(dir, 'hosts'))).sort(), [BUNDLE.sha256, `${BUNDLE.sha256}.json`]);
    assert.deepEqual(new Uint8Array(await readFile(keptManifestPath(join(dir, 'hosts'), BUNDLE.sha256))), MANIFEST);
  });

  it('opens every folder and file to this user only', { skip: !POSIX }, async () => {
    const folder = await bundleStage(await freshDir(), 'p1')(BUNDLE);
    assert.deepEqual(await kinds(folder), FRESH);
  });

  it('gives a copy that holds exactly the bundle again', async () => {
    const stage = bundleStage(await freshDir(), 'p1');
    const folder = await stage(BUNDLE);
    const before = (await lstat(folder)).ino;
    assert.equal(await stage(BUNDLE), folder);
    assert.equal((await lstat(folder)).ino, before);
  });

  it('makes a fresh copy when a listed file changed, at the same size too, or is gone', async () => {
    await restaged((folder) => writeFile(join(folder, 'dist', 'host.mjs'), 'tampered'));
    await restaged((folder) => writeFile(join(folder, 'dist', 'host.mjs'), 'export []);\n'.slice(0, HOST.byteLength)));
    await restaged((folder) => rm(join(folder, 'dist', 'lib', 'wire.mjs')));
  });

  it('makes a fresh copy when it holds a file or folder the manifest does not list, on every run', async () => {
    await restaged((folder) => privateFile(join(folder, 'dist', 'package.json'), '{"type":"commonjs"}'));
    await restaged((folder) => privateFile(join(folder, '.hidden'), ''));
    await restaged((folder) => mkdir(join(folder, 'node_modules'), { mode: 0o700 }));
    const stage = bundleStage(await freshDir(), 'p1');
    for (let run = 0; run < 3; run += 1) {
      const folder = await stage(BUNDLE);
      assert.deepEqual(await listing(folder), WHOLE);
      await privateFile(join(folder, `stray${run}`), '');
    }
  });

  it('makes a fresh copy when a file or a folder of it is now a link, even to the same bytes', { skip: !POSIX }, async () => {
    await restaged(async (folder) => {
      const outside = await freshDir();
      await rename(join(folder, 'dist', 'host.mjs'), join(outside, 'host.mjs'));
      await symlink(join(outside, 'host.mjs'), join(folder, 'dist', 'host.mjs'));
    });
    await restaged(async (folder) => {
      const outside = await freshDir();
      await rename(join(folder, 'dist', 'lib'), join(outside, 'lib'));
      await symlink(join(outside, 'lib'), join(folder, 'dist', 'lib'));
    });
    await restaged(async (folder) => {
      const outside = await freshDir();
      await rename(folder, join(outside, 'copy'));
      await symlink(join(outside, 'copy'), folder);
    });
  });

  it('makes a fresh copy when others may open it', { skip: !POSIX }, async () => {
    await restaged((folder) => chmod(join(folder, 'dist'), 0o755));
    await restaged((folder) => chmod(join(folder, 'dist', 'host.mjs'), 0o777));
  });

  it('gives one whole copy to stages that run at once, where none or a spoiled one was', async () => {
    for (let round = 0; round < 20; round += 1) {
      const dir = await freshDir();
      const spoiled = round % 2 === 1;
      if (spoiled) {
        await privateFile(join(await bundleStage(dir, 'p0')(BUNDLE), 'stray'), '');
      }
      const folders = await Promise.all(['p1', 'p2', 'p3', 'p4'].map((suffix) => bundleStage(dir, suffix)(BUNDLE)));
      assert.deepEqual(new Set(folders), new Set([join(dir, BUNDLE.sha256)]));
      assert.deepEqual(await listing(join(dir, BUNDLE.sha256)), WHOLE, `round ${round}`);
      assert.deepEqual(await kinds(join(dir, BUNDLE.sha256)), freshKinds());
      assert.deepEqual((await readdir(dir)).sort(), [BUNDLE.sha256, `${BUNDLE.sha256}.json`]);
    }
  });

  it('keeps a manifest whose rename was refused when the kept file holds its bytes, and throws after its tries when not', async () => {
    const dir = await freshDir();
    const kept = keptManifestPath(dir, BUNDLE.sha256);
    await writeFile(kept, MANIFEST);
    await keepManifest(join(dir, 'gone.tmp.json'), kept, MANIFEST);
    assert.deepEqual(await readFile(kept), Buffer.from(MANIFEST));
    const folder = keptManifestPath(dir, 'other');
    await mkdir(join(folder, 'inside'), { recursive: true });
    await writeFile(join(dir, 'other.tmp.json'), MANIFEST);
    await assert.rejects(keepManifest(join(dir, 'other.tmp.json'), folder, MANIFEST));
  });

  it('throws what the file system refused, for the transport to answer', async () => {
    const file = join(await freshDir(), 'a-file');
    await writeFile(file, 'not a folder');
    await assert.rejects(bundleStage(file, 'p1')(BUNDLE));
  });
});
