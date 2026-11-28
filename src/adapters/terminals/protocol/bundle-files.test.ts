import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBundleFile } from './bundle-files.ts';

const roots: string[] = [];

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'teamrig-bundle-'));
  roots.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('readBundleFile', () => {
  it('reads a file by its listed path, an empty one too', async () => {
    const root = await freshDir();
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'dist', 'host.mjs'), 'abc');
    await writeFile(join(root, 'empty'), '');
    assert.deepEqual(await readBundleFile(root, 'dist/host.mjs', 100), { kind: 'bytes', bytes: new TextEncoder().encode('abc') });
    assert.deepEqual(await readBundleFile(root, 'empty', 100), { kind: 'bytes', bytes: new Uint8Array() });
  });

  it('reads a file at its cap and refuses one a byte past it', async () => {
    const root = await freshDir();
    await writeFile(join(root, 'host'), 'abc');
    assert.equal((await readBundleFile(root, 'host', 3)).kind, 'bytes');
    assert.deepEqual(await readBundleFile(root, 'host', 2), { kind: 'refused', why: 'is over the 2 bytes left for it' });
  });

  it('finds a missing file, a missing folder and a file where a folder is named missing', async () => {
    const root = await freshDir();
    await writeFile(join(root, 'host'), 'abc');
    for (const path of ['none', 'none/host', 'host/inner']) {
      assert.deepEqual(await readBundleFile(root, path, 100), { kind: 'missing' }, path);
    }
  });

  it('throws any other failure, for its callers to answer', async () => {
    await assert.rejects(readBundleFile(await freshDir(), 'a\0b', 100));
  });

  it('refuses a folder', async () => {
    const root = await freshDir();
    await mkdir(join(root, 'dist'));
    if (process.platform === 'win32') {
      // Windows opens no folder as a file, so the read throws, which its callers answer as a failure.
      await assert.rejects(readBundleFile(root, 'dist', 100).then((reading) => { if (reading.kind === 'refused') throw new Error(reading.why); }));
      return;
    }
    assert.deepEqual(await readBundleFile(root, 'dist', 100), { kind: 'refused', why: 'is not a regular file' });
  });

  it('refuses a file reached by a link, at itself or at a folder on the way', { skip: process.platform === 'win32' }, async () => {
    const root = await freshDir();
    const outside = await freshDir();
    await writeFile(join(outside, 'host'), 'abc');
    await symlink(join(outside, 'host'), join(root, 'host'));
    await symlink(outside, join(root, 'dist'));
    for (const path of ['host', 'dist/host']) {
      assert.deepEqual(await readBundleFile(root, path, 100), { kind: 'refused', why: 'is reached by a link' }, path);
    }
  });
});
