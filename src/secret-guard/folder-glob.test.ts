import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { folderGlob, movedFolderSecrets } from './folder-glob.ts';

describe('folderGlob', () => {
  it('writes forward slashes, resolves dots and drops a trailing slash', () => {
    assert.equal(folderGlob('/srv/../cfg//', 'linux'), '/cfg');
    assert.equal(folderGlob('C:\\agents\\cfg\\', 'win32'), 'C:/agents/cfg');
    assert.equal(folderGlob('d:/', 'win32'), 'd:');
  });

  it('fits a Windows folder with no drive on any drive, and names a network share whole', () => {
    assert.equal(folderGlob('\\cfg', 'win32'), '?:/cfg');
    assert.equal(folderGlob('/agents/cfg/', 'win32'), '?:/agents/cfg');
    assert.equal(folderGlob('\\\\nas\\share\\cfg', 'win32'), '/nas/share/cfg');
  });

  it('reads each wildcard character of the name as that character alone', () => {
    assert.equal(folderGlob('/srv/a[1]*?', 'linux'), '/srv/a[[]1][*][?]');
  });
});

describe('movedFolderSecrets', () => {
  const NAMES = ['login.json', 'history.jsonl'];

  it('names each file in the moved folder, the value trimmed', () => {
    assert.deepEqual(movedFolderSecrets(' /cfg ', NAMES, 'linux'), ['/cfg/login.json', '/cfg/history.jsonl']);
    assert.deepEqual(movedFolderSecrets('/', NAMES, 'linux'), ['/login.json', '/history.jsonl']);
    assert.deepEqual(movedFolderSecrets('C:\\cfg', NAMES, 'win32'), ['C:/cfg/login.json', 'C:/cfg/history.jsonl']);
  });

  it('names none for an unset, blank or relative folder on the platform', () => {
    const values: readonly (readonly [string | undefined, NodeJS.Platform])[] = [
      [undefined, 'linux'],
      ['', 'linux'],
      ['  ', 'linux'],
      ['cfg', 'linux'],
      ['~/cfg', 'linux'],
      ['C:\\cfg', 'linux'],
      ['cfg', 'win32'],
      ['C:cfg', 'win32'],
    ];
    for (const [value, platform] of values) {
      assert.deepEqual(movedFolderSecrets(value, NAMES, platform), [], `${JSON.stringify(value)} on ${platform}`);
    }
  });
});
