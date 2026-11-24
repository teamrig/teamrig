import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aliasFormOf, lastSegmentOf, nativePathOf, openedNameOf, samePathKey } from './path-spelling.ts';

describe('samePathKey', () => {
  it('folds case, slashes and the trailing dots and spaces Windows drops, past the drive', () => {
    assert.equal(samePathKey('Config.JSON. ', 'C:\\U\\Kit', 'win32'), 'c:/u/kit/config.json');
    assert.equal(samePathKey('..\\b', 'C:/a/x', 'win32'), 'c:/a/b');
  });

  it('keeps case and trailing dots elsewhere', () => {
    assert.equal(samePathKey('Config.json.', '/srv/kit', 'linux'), '/srv/kit/Config.json.');
  });
});

describe('aliasFormOf', () => {
  it('tells the device, share and stream spellings from a plain path', () => {
    assert.equal(aliasFormOf('\\\\?\\C:\\u\\current'), 'a device path');
    assert.equal(aliasFormOf('//./C:/u/current'), 'a device path');
    assert.equal(aliasFormOf('\\\\host\\share\\current'), 'a network share path');
    assert.equal(aliasFormOf('C:/u/current.json:hidden'), 'an alternate data stream');
    assert.equal(aliasFormOf('C:/u/current.json'), undefined);
  });
});

describe('openedNameOf and lastSegmentOf', () => {
  it('names the file Windows opens: the stream cut, trailing dots dropped, past a bare drive', () => {
    assert.equal(lastSegmentOf('C:config.json'), 'config.json');
    assert.equal(openedNameOf('C:/u/current.json.:s'), 'current.json');
  });
});

describe('nativePathOf', () => {
  it('reads a Git Bash drive as the Windows drive, and leaves other platforms alone', () => {
    assert.equal(nativePathOf('/c/kit/x', 'win32'), 'c:/kit/x');
    assert.equal(nativePathOf('/c/kit/x', 'linux'), '/c/kit/x');
  });
});
