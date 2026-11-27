import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  folderSignalsOver,
  nodeFolderSignals,
  type FolderWatch,
  type SystemWatcher,
  type WatchFolder,
} from './folder-signals.ts';

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

/**
 * Whether `changes()` passes `seen`, making a change with `act` before each 100 ms wait on a timer while it does not.
 * A system watch may drop one change (macOS FSEvents coalesces a `mkdir -p`), so one bare await of a change could
 * leave the loop with nothing to wait on; the timer holds it, and the next try is told.
 */
async function toldPast(
  seen: number,
  changes: () => number,
  act: (tries: number) => Promise<void>,
): Promise<boolean> {
  for (let tries = 0; tries < 40; tries += 1) {
    for (let waited = 0; changes() === seen && waited < 100; waited += 10) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (changes() > seen) {
      return true;
    }
    await act(tries);
  }
  return changes() > seen;
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
    const watch = nodeFolderSignals.watch([folder], () => {
      changes += 1;
    });
    open.push(watch);
    assert.deepEqual(watch.unwatched(), []);
    await mkdir(folder, { recursive: true });
    // Should the system drop the made folders' change, a file written in the watched folder above is one more.
    const made = await toldPast(0, () => changes, (tries) => writeFile(join(root, 'above.md'), `${tries}\n`));
    assert.ok(made, 'no change told in the folder above the one not there yet');
    // Made: the folder's own watch now tells of a file in it, which the watch above it would not.
    const seen = changes;
    const written = await toldPast(seen, () => changes, (tries) => writeFile(join(folder, 'T1.json'), `${tries}\n`));
    assert.ok(written, 'no change told of a file in the folder made after the watch');
  });

  it('names a folder the system refuses to watch for a reason other than its absence', () => {
    const refused = join(root, 'bad\0name');
    const watch = nodeFolderSignals.watch([refused], () => undefined);
    open.push(watch);
    assert.deepEqual(watch.unwatched(), [refused]);
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

/** A system watch a spec drives by hand: a change, an error, and whether it was closed. */
class HandWatcher implements SystemWatcher {
  readonly folder: string;
  readonly onEvent: () => void;
  closes = 0;
  private onError: ((error: Error) => void) | undefined;

  constructor(folder: string, onEvent: () => void) {
    this.folder = folder;
    this.onEvent = onEvent;
  }

  on(event: 'error', listener: (error: Error) => void): this {
    this.onError = listener;
    return this;
  }

  close(): void {
    this.closes += 1;
  }

  fail(): void {
    this.onError?.(new Error('watch ended'));
  }
}

describe('folderSignalsOver', () => {
  function handWatches(): { readonly started: HandWatcher[]; readonly watchFolder: WatchFolder } {
    const started: HandWatcher[] = [];
    return {
      started,
      watchFolder: (folder, onEvent) => {
        const watcher = new HandWatcher(folder, onEvent);
        started.push(watcher);
        return watcher;
      },
    };
  }

  it('names a folder whose watch ended with an error, closes that watch and tells of it once', () => {
    const { started, watchFolder } = handWatches();
    let changes = 0;
    const watch = folderSignalsOver(watchFolder).watch(['/t/a', '/t/b'], () => {
      changes += 1;
    });
    started[0]?.fail();
    assert.deepEqual(watch.unwatched(), ['/t/a']);
    assert.equal(started[0]?.closes, 1);
    assert.equal(changes, 1);
  });

  it('tells nothing of a change or an error the system delivers after close, and closes twice safely', () => {
    const { started, watchFolder } = handWatches();
    let changes = 0;
    const watch = folderSignalsOver(watchFolder).watch(['/t/a'], () => {
      changes += 1;
    });
    watch.close();
    watch.close();
    started[0]?.onEvent();
    started[0]?.fail();
    assert.equal(changes, 0);
    assert.deepEqual(watch.unwatched(), []);
    assert.equal(started[0]?.closes, 1);
  });

  it('names a folder none of whose folders above it can be watched', () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const watch = folderSignalsOver(() => {
      throw missing;
    }).watch(['/t/a'], () => undefined);
    assert.deepEqual(watch.unwatched(), ['/t/a']);
  });
});
