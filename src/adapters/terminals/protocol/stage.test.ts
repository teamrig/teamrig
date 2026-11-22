import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Of } from './spawn.ts';
import { privateStage } from './stage.ts';

const roots: string[] = [];

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'teamrig-stage-'));
  roots.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

const BYTES = new TextEncoder().encode('#!/bin/sh\necho pinned\n');
const SHA = sha256Of(BYTES);

describe('privateStage', () => {
  it('copies the bytes to <dir>/<sha256>/<name> and leaves no temporary file', async () => {
    const dir = await freshDir();
    const path = await privateStage(dir, 'p1')(BYTES, SHA, 'host');
    assert.equal(path, join(dir, SHA, 'host'));
    assert.deepEqual(new Uint8Array(await readFile(path)), BYTES);
    assert.deepEqual(await readdir(join(dir, SHA)), ['host']);
  });

  it('opens the folder and the copy to this user only', async () => {
    // Windows reports only a read-only bit, so a writable file reads 0o666 there; its privacy is the profile's access list.
    const expected = process.platform === 'win32' ? 0o666 : 0o700;
    const dir = await freshDir();
    const path = await privateStage(dir, 'p1')(BYTES, SHA, 'host');
    assert.equal((await stat(join(dir, SHA))).mode & 0o777, expected);
    assert.equal((await stat(path)).mode & 0o777, expected);
  });

  it('gives a copy that still holds the pinned bytes again', async () => {
    const dir = await freshDir();
    const stage = privateStage(dir, 'p1');
    const first = await stage(BYTES, SHA, 'host');
    const before = (await stat(first)).mtimeMs;
    assert.equal(await stage(BYTES, SHA, 'host'), first);
    assert.equal((await stat(first)).mtimeMs, before);
  });

  it('writes anew a copy whose bytes changed since it was made', async () => {
    const dir = await freshDir();
    const stage = privateStage(dir, 'p1');
    const path = await stage(BYTES, SHA, 'host');
    await writeFile(path, 'tampered');
    await stage(BYTES, SHA, 'host');
    assert.deepEqual(new Uint8Array(await readFile(path)), BYTES);
  });

  it('throws what the file system refused, for the transport to answer', async () => {
    const dir = await freshDir();
    const file = join(dir, 'a-file');
    await writeFile(file, 'not a folder');
    await assert.rejects(privateStage(file, 'p1')(BYTES, SHA, 'host'));
  });
});
