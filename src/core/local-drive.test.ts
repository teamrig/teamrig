import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onLocalDrive } from './local-drive.ts';

describe('onLocalDrive (T3038)', () => {
  it('takes a drive path on any host, and a root path only off Windows', () => {
    assert.equal(onLocalDrive('C:\\w\\x.js', 'win32'), true);
    assert.equal(onLocalDrive('d:/w/x.js', 'win32'), true);
    assert.equal(onLocalDrive('/srv/w/x.sh', 'linux'), true);
    assert.equal(onLocalDrive('/w/x.js', 'win32'), false);
  });

  it('refuses a share, a device and a relative path on every host', () => {
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
      for (const path of ['//host/share/x.sh', '\\\\host\\share\\x.js', '\\\\?\\UNC\\host\\share\\x.py', '\\\\.\\pipe\\x', '\\w\\x.js', 'x.js', 'C:x.js']) {
        assert.equal(onLocalDrive(path, platform), false, `${platform} ${path}`);
      }
    }
  });
});
