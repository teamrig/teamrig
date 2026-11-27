import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from 'node:path';
import { MemoryFiles } from '../testing/memory-files.ts';
import { ReachedFolders } from './reached-folders.ts';

describe('ReachedFolders', () => {
  it('keeps the folder of each file a recorded call reaches and each folder it lists, sorted and each once', async () => {
    const files = new ReachedFolders(new MemoryFiles({ '/t/a/one.md': 'x', '/t/b/two.md': 'y' }));
    const { value, folders } = await files.record(async () => {
      await files.stamp('/t/b/two.md');
      await files.read('/t/a/one.md');
      await files.size('/t/a/gone.md');
      await files.list('/t/c');
      return 'done';
    });
    assert.equal(value, 'done');
    assert.deepEqual(folders, ['/t/a', '/t/b', '/t/c'].map(normalize));
  });

  it('keeps nothing outside a recording, and passes every call through', async () => {
    const inner = new MemoryFiles({ '/t/a/one.md': 'x' });
    const files = new ReachedFolders(inner);
    await files.stamp('/t/a/one.md');
    await files.write('/t/z/new.md', 'n');
    const { folders } = await files.record(async () => files.read('/t/z/new.md'));
    assert.deepEqual(folders, [normalize('/t/z')]);
    assert.equal(await inner.read('/t/z/new.md'), 'n');
  });

  it('keeps a folder named with either separator once, in the platform form a folder watch takes', async () => {
    const files = new ReachedFolders(new MemoryFiles({}));
    const { folders } = await files.record(async () => {
      await files.stamp('/t/a/one.md');
      await files.stamp(normalize('/t/a/two.md'));
      await files.list(normalize('/t/a'));
    });
    assert.deepEqual(folders, [normalize('/t/a')]);
  });

  it('ends a recording that throws, so later calls are kept by no one', async () => {
    const files = new ReachedFolders(new MemoryFiles({}));
    await assert.rejects(files.record(async () => {
      await files.stamp('/t/a/one.md');
      throw new Error('stopped');
    }), /stopped/);
    await files.stamp('/t/b/two.md');
    const { folders } = await files.record(async () => undefined);
    assert.deepEqual(folders, []);
  });
});
