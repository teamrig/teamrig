import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PathKind, PathProbe } from './path-probe.ts';
import { storeWriter, type StoreProgramDeps } from './store-program.ts';

/** A filesystem holding only `files` as files and `folders` as folders. */
function holding(files: readonly string[], folders: readonly string[] = []): PathProbe {
  return {
    async kind(path): Promise<PathKind> {
      return files.includes(path) ? 'file' : folders.includes(path) ? 'folder' : 'none';
    },
  };
}

const windows = (cwd: string, files: readonly string[], env: StoreProgramDeps['env'] = { SystemRoot: 'C:\\Windows' }, folders: readonly string[] = []): StoreProgramDeps => ({
  platform: 'win32',
  env,
  cwd,
  probe: holding(files, folders),
});

const SYSTEM_CMDKEY = 'C:\\Windows\\System32\\cmdkey.exe';

describe('storeWriter', () => {
  it("takes Windows' cmdkey from System32, never the one in the current folder", async () => {
    const found = await storeWriter(windows('C:\\repo', [SYSTEM_CMDKEY, 'C:\\repo\\cmdkey.exe']));
    assert.deepEqual(found, { kind: 'found', path: SYSTEM_CMDKEY });
  });

  it('reads SystemRoot in any case, and refuses one that is missing or relative', async () => {
    assert.deepEqual(await storeWriter(windows('C:\\repo', [SYSTEM_CMDKEY], { SYSTEMROOT: 'C:\\Windows' })), { kind: 'found', path: SYSTEM_CMDKEY });
    assert.equal((await storeWriter(windows('C:\\repo', [SYSTEM_CMDKEY], {}))).kind, 'refused');
    assert.equal((await storeWriter(windows('C:\\repo', ['Windows\\System32\\cmdkey.exe'], { SystemRoot: 'Windows' }))).kind, 'refused');
  });

  it('refuses a SystemRoot pointing into the current folder, or into the repo or worktree holding it', async () => {
    const planted = 'C:\\repo\\sub\\System32\\cmdkey.exe';
    const inCwd = await storeWriter(windows('C:\\repo\\sub', [planted], { SystemRoot: 'C:\\repo\\sub' }));
    assert.equal(inCwd.kind, 'refused');
    const inRepo = await storeWriter(windows('C:\\Repo\\sub', ['C:\\repo\\System32\\cmdkey.exe'], { SystemRoot: 'C:\\repo' }, ['C:\\Repo\\.git']));
    assert.deepEqual(inRepo, {
      kind: 'refused',
      reason: "C:\\repo\\System32\\cmdkey.exe is inside C:\\Repo, where a session could have put it; teamrig runs the store's tool only from outside it",
    });
  });

  it('refuses a cmdkey.exe System32 does not hold', async () => {
    assert.deepEqual(await storeWriter(windows('C:\\repo', [])), { kind: 'refused', reason: `${SYSTEM_CMDKEY} is not there` });
  });

  it("takes macOS' security from /usr/bin, whatever PATH says", async () => {
    const deps: StoreProgramDeps = { platform: 'darwin', env: { PATH: '.:/repo/bin' }, cwd: '/repo', probe: holding(['/usr/bin/security', '/repo/security', '/repo/bin/security']) };
    assert.deepEqual(await storeWriter(deps), { kind: 'found', path: '/usr/bin/security' });
  });

  it("takes Linux' secret-tool from PATH's absolute folders only, skipping empty and relative ones", async () => {
    const deps: StoreProgramDeps = {
      platform: 'linux',
      env: { PATH: '::.:bin:/usr/local/bin:/usr/bin' },
      cwd: '/srv/work/repo',
      probe: holding(['/srv/work/repo/secret-tool', '/srv/work/repo/bin/secret-tool', '/usr/bin/secret-tool']),
    };
    assert.deepEqual(await storeWriter(deps), { kind: 'found', path: '/usr/bin/secret-tool' });
  });

  it('refuses a secret-tool on PATH inside the repo holding the current folder, and none on PATH', async () => {
    const inRepo: StoreProgramDeps = {
      platform: 'linux',
      env: { PATH: '/srv/work/repo/node_modules/.bin:/usr/bin' },
      cwd: '/srv/work/repo/src',
      probe: holding(['/srv/work/repo/node_modules/.bin/secret-tool', '/usr/bin/secret-tool'], ['/srv/work/repo/.git']),
    };
    assert.equal((await storeWriter(inRepo)).kind, 'refused');
    const none: StoreProgramDeps = { platform: 'linux', env: { PATH: '/usr/bin' }, cwd: '/srv/work', probe: holding([]) };
    assert.deepEqual(await storeWriter(none), { kind: 'refused', reason: "secret-tool is in none of PATH's absolute folders: install libsecret's tools" });
  });

  it('takes a worktree whose .git is a file as the folder to stay out of', async () => {
    const deps: StoreProgramDeps = {
      platform: 'linux',
      env: { PATH: '/wt/bin' },
      cwd: '/wt/src',
      probe: holding(['/wt/bin/secret-tool', '/wt/.git']),
    };
    assert.equal((await storeWriter(deps)).kind, 'refused');
  });
});
