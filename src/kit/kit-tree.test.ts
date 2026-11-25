import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeKitTree } from './kit-tree.ts';

/** A throwaway folder, so the real file system's copy and removal are read as kit-versions.ts takes them. */
const root = mkdtempSync(join(tmpdir(), 'teamrig-kit-tree-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** A release folder with a text file, a binary file and a nested folder. */
function release(name: string): string {
  const folder = join(root, name);
  mkdirSync(join(folder, 'dist', 'hooks'), { recursive: true });
  writeFileSync(join(folder, 'package.json'), '{"version":"0.508.0"}');
  writeFileSync(join(folder, 'dist', 'hooks', 'font.bin'), Buffer.from([0x00, 0xff, 0x80, 0x0a, 0x0d]));
  return folder;
}

describe('nodeKitTree', () => {
  it('copies a folder with all it holds, a binary file byte for byte', async () => {
    const from = release('copy-from');
    const to = join(root, 'copy-to');
    await nodeKitTree().copyFolder(from, to);
    assert.equal(readFileSync(join(to, 'package.json'), 'utf8'), '{"version":"0.508.0"}');
    assert.deepEqual([...readFileSync(join(to, 'dist', 'hooks', 'font.bin'))], [0x00, 0xff, 0x80, 0x0a, 0x0d]);
  });

  it('throws when something is at the target already, leaving it as it was', async () => {
    const from = release('exists-from');
    const to = join(root, 'exists-to');
    mkdirSync(to);
    writeFileSync(join(to, 'package.json'), 'kept');
    await assert.rejects(nodeKitTree().copyFolder(from, to));
    assert.equal(readFileSync(join(to, 'package.json'), 'utf8'), 'kept');
  });

  it('leaves a link out of the copy, never following it', async () => {
    const from = release('link-from');
    const outside = join(root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'outside');
    // A junction needs no rights on Windows; elsewhere the type is ignored and a plain symlink is made.
    symlinkSync(outside, join(from, 'linked'), 'junction');
    const to = join(root, 'link-to');
    await nodeKitTree().copyFolder(from, to);
    assert.equal(existsSync(join(to, 'linked')), false);
    assert.equal(existsSync(join(to, 'package.json')), true);
  });

  it('copies what a root that is itself a link names, still leaving links inside it out', async () => {
    const real = release('root-link-real');
    const outside = join(root, 'root-link-outside');
    mkdirSync(outside);
    symlinkSync(outside, join(real, 'linked'), 'junction');
    const from = join(root, 'root-link-from');
    symlinkSync(real, from, 'junction');
    const to = join(root, 'root-link-to');
    await nodeKitTree().copyFolder(from, to);
    assert.equal(readFileSync(join(to, 'package.json'), 'utf8'), '{"version":"0.508.0"}');
    assert.equal(existsSync(join(to, 'linked')), false);
  });

  it('removes a folder with all it holds, and does nothing for one that is missing', async () => {
    const folder = release('remove');
    await nodeKitTree().removeFolder(folder);
    assert.equal(existsSync(folder), false);
    await nodeKitTree().removeFolder(join(root, 'never-there'));
  });
});
