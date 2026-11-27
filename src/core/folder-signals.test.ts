import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeFolderSignals, type FolderWatch } from './folder-signals.ts';

/** The longest a change may take to be told of; the system's watches tell within milliseconds. */
const TOLD_WITHIN_MS = 4_000;

/** Resolves at the next change `watchOf`'s watch tells of; rejects past {@link TOLD_WITHIN_MS}. */
function nextChange(): { readonly onChange: () => void; readonly told: Promise<void> } {
  let tell: () => void = () => undefined;
  const told = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no change told within ${TOLD_WITHIN_MS} ms`)), TOLD_WITHIN_MS);
    tell = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  return { onChange: () => tell(), told };
}

describe('nodeFolderSignals', () => {
  let root = '';
  const open: FolderWatch[] = [];

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'kit-signals-'));
  });

  after(async () => {
    for (const watch of open) {
      watch.close();
    }
    await rm(root, { recursive: true, force: true });
  });

  it('tells of a file written in a watched folder', async () => {
    const folder = join(root, 'inbox');
    await mkdir(folder);
    const { onChange, told } = nextChange();
    const watch = nodeFolderSignals.watch([folder, folder], onChange);
    open.push(watch);
    assert.deepEqual(watch.unwatched(), []);
    await writeFile(join(folder, 'alpha.md'), 'one\n');
    await told;
  });

  it('watches a folder not there yet through the folder above it, and the folder itself once it is made', async () => {
    const folder = join(root, 'later', 'tasks');
    let changes = 0;
    let tell: () => void = () => undefined;
    const watch = nodeFolderSignals.watch([folder], () => {
      changes += 1;
      tell();
    });
    open.push(watch);
    assert.deepEqual(watch.unwatched(), []);
    const made = new Promise<void>((resolve) => (tell = resolve));
    await mkdir(folder, { recursive: true });
    await made;
    // Made: the folder's own watch now tells of a file in it, which the watch above it would not.
    const seen = changes;
    const written = new Promise<void>((resolve) => (tell = resolve));
    for (let tries = 0; changes === seen && tries < 40; tries += 1) {
      await writeFile(join(folder, 'T1.json'), `${tries}\n`);
      await Promise.race([written, new Promise((resolve) => setTimeout(resolve, 100))]);
    }
    assert.ok(changes > seen, 'no change told of a file in the folder made after the watch');
  });

  it('tells nothing once closed', async () => {
    const folder = join(root, 'closed');
    await mkdir(folder);
    let changes = 0;
    const watch = nodeFolderSignals.watch([folder], () => {
      changes += 1;
    });
    watch.close();
    await writeFile(join(folder, 'one.md'), 'x');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(changes, 0);
  });
});
