import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { seedKitHome } from '../testing/kit-home.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { WatchedFiles } from '../testing/watched-files.ts';
import { kitCurrentPath } from './kit-versions.ts';
import { CurrentVersionReader, currentVersion, newerCurrent, newerVersion } from './newer-current.ts';

const KIT_HOME = '/opt/team/.teamrig';

describe('newerVersion', () => {
  it('names the current version only when it is newer than the running one', () => {
    assert.equal(newerVersion('0.511.0', '0.510.0'), '0.511.0');
    assert.equal(newerVersion('0.511.0', '0.511.0'), undefined);
    assert.equal(newerVersion('0.511.0', '0.512.0'), undefined);
    assert.equal(newerVersion(undefined, '0.510.0'), undefined);
    assert.equal(newerVersion('0.511.0', 'dev'), undefined);
    assert.equal(newerVersion('next', '0.510.0'), undefined);
  });
});

describe('currentVersion', () => {
  it('reads the version current names, none while it is missing or its records disagree', async () => {
    const files = new MemoryFiles();
    assert.equal(await currentVersion(files, KIT_HOME), undefined);
    await seedKitHome(files, KIT_HOME, '0.511.0');
    assert.equal(await currentVersion(files, KIT_HOME), '0.511.0');
    await files.write(kitCurrentPath(KIT_HOME), '0.512.0\n');
    assert.equal(await currentVersion(files, KIT_HOME), undefined);
  });
});

describe('CurrentVersionReader', () => {
  it('opens the records only when a stamp moved, and reads the version an install moved current to', async () => {
    const store = new MemoryFiles();
    await seedKitHome(store, KIT_HOME, '0.511.0');
    const files = new WatchedFiles(store);
    const reader = new CurrentVersionReader(files, KIT_HOME);
    assert.equal(await reader.version(), '0.511.0');
    const openedFirst = files.opened().length;
    assert.ok(openedFirst > 0);
    assert.equal(await reader.version(), '0.511.0');
    assert.equal(files.opened().length, openedFirst);
    await seedKitHome(store, KIT_HOME, '0.512.0');
    assert.equal(await reader.version(), '0.512.0');
    assert.ok(files.opened().length > openedFirst);
  });

  it('reads none while current is missing, and the version once an install writes it', async () => {
    const store = new MemoryFiles();
    const reader = new CurrentVersionReader(store, KIT_HOME);
    assert.equal(await reader.version(), undefined);
    await seedKitHome(store, KIT_HOME, '0.511.0');
    assert.equal(await reader.version(), '0.511.0');
  });
});

describe('newerCurrent', () => {
  it('names the version current names only when it is newer than the running one', async () => {
    const files = new MemoryFiles();
    assert.equal(await newerCurrent(files, KIT_HOME, '0.510.0'), undefined);
    await seedKitHome(files, KIT_HOME, '0.511.0');
    assert.equal(await newerCurrent(files, KIT_HOME, '0.510.0'), '0.511.0');
    assert.equal(await newerCurrent(files, KIT_HOME, '0.511.0'), undefined);
    assert.equal(await newerCurrent(files, KIT_HOME, '0.512.0'), undefined);
    assert.equal(await newerCurrent(files, KIT_HOME, 'dev'), undefined);
  });
});
