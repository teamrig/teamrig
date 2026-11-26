import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stepFolderOf } from './step-folder.ts';

describe('stepFolderOf on Windows (cmd.exe)', () => {
  const cwd = 'C:\\src\\app';

  it("follows a leading `cd /d <dir> &&`, plain or quoted, to the folder the line's command runs in", () => {
    assert.equal(stepFolderOf(['cd /d C:/wt/fix && npm run check'], cwd, 'win32'), 'C:\\wt\\fix');
    assert.equal(stepFolderOf(['cd /d "C:\\work tree\\fix" && npm test'], cwd, 'win32'), 'C:\\work tree\\fix');
    assert.equal(stepFolderOf(['CD /D D:\\wt&&npm test'], cwd, 'win32'), 'D:\\wt');
  });

  it('follows `chdir` and `pushd` the same way', () => {
    assert.equal(stepFolderOf(['chdir /d C:\\wt && npm test'], cwd, 'win32'), 'C:\\wt');
    assert.equal(stepFolderOf(['pushd D:\\wt && npm test'], cwd, 'win32'), 'D:\\wt');
  });

  it('follows chained moves, a relative one resolved from the folder before it', () => {
    assert.equal(stepFolderOf(['cd /d C:\\wt && cd packages\\core && npm test'], cwd, 'win32'), 'C:\\wt\\packages\\core');
    assert.equal(stepFolderOf(['cd .. && npm test'], cwd, 'win32'), 'C:\\src');
  });

  it('moves a `cd` without `/d` within the same drive only, as cmd.exe does', () => {
    assert.equal(stepFolderOf(['cd C:\\wt && npm test'], cwd, 'win32'), 'C:\\wt');
    assert.equal(stepFolderOf(['cd D:\\wt && npm test'], cwd, 'win32'), cwd);
  });

  it('keeps the folder for a move the shell would expand, a move with nothing after it, or no move', () => {
    assert.equal(stepFolderOf(['cd /d %USERPROFILE%\\wt && npm test'], cwd, 'win32'), cwd);
    assert.equal(stepFolderOf(['cd /d C:\\wt'], cwd, 'win32'), cwd);
    assert.equal(stepFolderOf(['cd /d C:\\wt & npm test'], cwd, 'win32'), cwd);
    assert.equal(stepFolderOf(['npm test && cd /d C:\\wt'], cwd, 'win32'), cwd);
    assert.equal(stepFolderOf(['pushd /d C:\\wt && npm test'], cwd, 'win32'), cwd);
  });

  it('keeps the folder for a program given as several words, which moves nothing', () => {
    assert.equal(stepFolderOf(['cd', '/d', 'C:\\wt', '&&', 'npm', 'test'], cwd, 'win32'), cwd);
    assert.equal(stepFolderOf(['npm', 'test'], cwd, 'win32'), cwd);
    assert.equal(stepFolderOf([], cwd, 'win32'), cwd);
  });
});

describe('stepFolderOf on POSIX shells', () => {
  const cwd = '/srv/dev/app';

  it('follows a leading `cd <dir> &&`, plain, single- or double-quoted', () => {
    assert.equal(stepFolderOf(['cd /wt/fix && npm run check'], cwd, 'linux'), '/wt/fix');
    assert.equal(stepFolderOf(["cd '/work tree/fix' && npm test"], cwd, 'darwin'), '/work tree/fix');
    assert.equal(stepFolderOf(['cd "/work tree/fix" && npm test'], cwd, 'linux'), '/work tree/fix');
  });

  it('follows chained and relative moves', () => {
    assert.equal(stepFolderOf(['cd /wt && cd packages/core && npm test'], cwd, 'linux'), '/wt/packages/core');
    assert.equal(stepFolderOf(['cd .. && npm test'], cwd, 'linux'), '/srv/dev');
  });

  it('keeps the folder for `$HOME`, `~`, `cd -`, a glob, or a move with nothing after it', () => {
    assert.equal(stepFolderOf(['cd $HOME/wt && npm test'], cwd, 'linux'), cwd);
    assert.equal(stepFolderOf(['cd "$HOME/wt" && npm test'], cwd, 'linux'), cwd);
    assert.equal(stepFolderOf(['cd ~/wt && npm test'], cwd, 'linux'), cwd);
    assert.equal(stepFolderOf(['cd - && npm test'], cwd, 'linux'), cwd);
    assert.equal(stepFolderOf(['cd /wt/* && npm test'], cwd, 'linux'), cwd);
    assert.equal(stepFolderOf(['cd /wt; npm test'], cwd, 'linux'), cwd);
  });

  it('keeps the folder for a program given as several words', () => {
    assert.equal(stepFolderOf(['cd', '/wt', '&&', 'npm', 'test'], cwd, 'linux'), cwd);
  });
});
