import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { LockBusyError, type Mutex } from '../core/lock.ts';
import { CLIENT_MANIFEST, clientFileHash } from '../exec/client-integrity.ts';
import { InlineMutex } from '../testing/inline-mutex.ts';
import { kitReleaseMain, writeKitRelease } from '../testing/kit-release.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { MemoryKitTree } from '../testing/memory-kit-tree.ts';
import {
  installKitVersion,
  kitCurrentPath,
  kitCurrentRecordPath,
  kitVersionFolder,
  listKitVersions,
  pruneKitVersions,
  readKitCurrent,
  useKitVersion,
  type KitInstall,
  type KitInstallOutcome,
  type KitSource,
} from './kit-versions.ts';

const KIT = '/home/user/.teamrig';
const PLUGIN = '/home/user/.claude/plugins/cache/teamrig/teamrig';
const SOURCE: KitSource = { kind: 'claude-code-plugin' };

class BusyMutex implements Mutex {
  async run<T>(): Promise<T> {
    throw new LockBusyError('install.lock', 0);
  }
}

describe('kit versions', () => {
  let files: MemoryFiles;
  let tree: MemoryKitTree;
  const install = (version: string, overrides: Partial<KitInstall> = {}): Promise<KitInstallOutcome> =>
    installKitVersion({ files, tree, kitHome: KIT, from: join(PLUGIN, version), version, source: SOURCE, lock: new InlineMutex(), ...overrides });

  beforeEach(async () => {
    files = new MemoryFiles();
    tree = new MemoryKitTree(files);
    for (const version of ['0.507.0', '0.508.0', '0.509.0', '0.510.0', '0.511.0']) {
      await writeKitRelease(files, join(PLUGIN, version), version);
    }
  });

  describe('installKitVersion', () => {
    it('copies the release into versions/<v>, then names it in current and current.json', async () => {
      assert.deepEqual(await install('0.508.0'), { kind: 'installed', version: '0.508.0' });
      assert.equal(files.get(kitCurrentPath(KIT)), '0.508.0\n');
      const current = await readKitCurrent(files, KIT);
      assert.equal(current?.version, '0.508.0');
      assert.equal(current?.pinned, false);
      assert.equal(current?.listHash, clientFileHash(files.get(join(PLUGIN, '0.508.0', CLIENT_MANIFEST)) ?? ''));
      assert.equal(files.get(join(kitVersionFolder(KIT, '0.508.0'), 'skills', 'guide', 'SKILL.md')), '# guide\n');
      assert.deepEqual(await files.list(join(KIT, 'versions')), ['0.508.0', '0.508.0.source.json']);
    });

    it('copies nothing again for the version in use', async () => {
      await install('0.508.0');
      assert.deepEqual(await install('0.508.0'), { kind: 'current', version: '0.508.0' });
      assert.equal(tree.copies.length, 1);
    });

    it('moves current up to a newer version and names the one before', async () => {
      await install('0.508.0');
      assert.deepEqual(await install('0.509.0'), { kind: 'installed', version: '0.509.0', previous: '0.508.0' });
      assert.equal((await readKitCurrent(files, KIT))?.version, '0.509.0');
    });

    it('keeps an older version it is given but never moves current down to it', async () => {
      await install('0.509.0');
      assert.deepEqual(await install('0.508.0'), { kind: 'older', version: '0.508.0', current: '0.509.0' });
      assert.equal((await readKitCurrent(files, KIT))?.version, '0.509.0');
      assert.deepEqual(await listKitVersions(files, KIT), ['0.509.0', '0.508.0']);
    });

    it('leaves current untouched and no folder behind when the copy fails partway', async () => {
      await install('0.508.0');
      tree.failCopyAfter = 2;
      assert.equal((await install('0.509.0')).kind, 'refused');
      assert.equal(files.get(kitCurrentPath(KIT)), '0.508.0\n');
      assert.deepEqual(await listKitVersions(files, KIT), ['0.508.0']);
      assert.deepEqual(await files.list(join(KIT, 'versions')), ['0.508.0', '0.508.0.source.json']);
    });

    it('refuses a release whose files do not match its list, and moves nothing', async () => {
      await install('0.508.0');
      await files.write(join(PLUGIN, '0.509.0', 'dist', 'cli', 'main.js'), 'hot patch\n');
      assert.deepEqual(await install('0.509.0'), {
        kind: 'refused',
        why: `the copy of 0.509.0 is not whole: files do not match ${CLIENT_MANIFEST}: dist/cli/main.js`,
      });
      assert.equal(files.get(kitCurrentPath(KIT)), '0.508.0\n');
    });

    it("refuses a release whose plugin.json names another version than the folder it would fill", async () => {
      assert.deepEqual(await install('0.509.0', { from: join(PLUGIN, '0.508.0') }), {
        kind: 'refused',
        why: 'the copy of 0.509.0 is not whole: .claude-plugin/plugin.json names version 0.508.0, not 0.509.0',
      });
      assert.equal(files.get(kitCurrentPath(KIT)), undefined);
    });

    it('copies a damaged kept version again before naming it', async () => {
      await install('0.508.0');
      await files.write(join(kitVersionFolder(KIT, '0.509.0'), 'dist', 'cli', 'main.js'), 'stale\n');
      assert.deepEqual(await install('0.509.0'), { kind: 'installed', version: '0.509.0', previous: '0.508.0' });
      assert.equal(files.get(join(kitVersionFolder(KIT, '0.509.0'), 'dist', 'cli', 'main.js')), kitReleaseMain('0.509.0'));
    });

    it('refuses a version that is no release version, a path above all', async () => {
      assert.deepEqual(await install('../x'), { kind: 'refused', why: '../x is no release version' });
      assert.equal(tree.copies.length, 0);
    });

    it('is busy, copying nothing, while another process holds the install lock', async () => {
      assert.deepEqual(await install('0.508.0', { lock: new BusyMutex() }), { kind: 'busy' });
      assert.equal(tree.copies.length, 0);
    });
  });

  describe('useKitVersion and the pin', () => {
    it('pins a kept older version, so a later install of a newer plugin leaves current there', async () => {
      await install('0.508.0');
      await install('0.509.0');
      assert.deepEqual(await useKitVersion({ files, tree, kitHome: KIT }, { kind: 'version', version: '0.508.0' }), {
        kind: 'moved',
        version: '0.508.0',
        previous: '0.509.0',
        pinned: true,
      });
      assert.deepEqual(await install('0.510.0'), { kind: 'pinned', version: '0.510.0', pinned: '0.508.0' });
      assert.equal((await readKitCurrent(files, KIT))?.version, '0.508.0');
      assert.deepEqual(await listKitVersions(files, KIT), ['0.510.0', '0.509.0', '0.508.0']);
    });

    it('use --latest moves to the newest kept version and clears the pin', async () => {
      await install('0.508.0');
      await install('0.509.0');
      await useKitVersion({ files, tree, kitHome: KIT }, { kind: 'version', version: '0.508.0' });
      await install('0.510.0');
      assert.deepEqual(await useKitVersion({ files, tree, kitHome: KIT }, { kind: 'latest' }), {
        kind: 'moved',
        version: '0.510.0',
        previous: '0.508.0',
        pinned: false,
      });
      assert.deepEqual(await install('0.511.0'), { kind: 'installed', version: '0.511.0', previous: '0.510.0' });
    });

    it('refuses a version that is not kept, or whose files changed since install', async () => {
      await install('0.508.0');
      await install('0.509.0');
      const ports = { files, tree, kitHome: KIT };
      assert.deepEqual(await useKitVersion(ports, { kind: 'version', version: '0.400.0' }), { kind: 'refused', why: '0.400.0 is not installed; kept: 0.509.0, 0.508.0' });
      await files.write(join(kitVersionFolder(KIT, '0.508.0'), 'package.json'), '{"type":"commonjs"}\n');
      assert.deepEqual(await useKitVersion(ports, { kind: 'version', version: '0.508.0' }), {
        kind: 'refused',
        why: `0.508.0 is damaged (files do not match ${CLIENT_MANIFEST}: package.json); install it again`,
      });
      assert.equal((await readKitCurrent(files, KIT))?.version, '0.509.0');
    });

    it('refuses with no version installed', async () => {
      assert.equal((await useKitVersion({ files, tree, kitHome: KIT }, { kind: 'latest' })).kind, 'refused');
    });
  });

  describe('readKitCurrent', () => {
    it('reads no version in use when current is a path, empty, or disagrees with current.json', async () => {
      await install('0.508.0');
      for (const line of ['../x\n', '\n', '0.509.0\n', 'C:\\evil\n']) {
        await files.write(kitCurrentPath(KIT), line);
        assert.equal(await readKitCurrent(files, KIT), undefined, JSON.stringify(line));
      }
    });

    it('reads no version in use from a current.json with a malformed list hash', async () => {
      await install('0.508.0');
      const record = files.get(kitCurrentRecordPath(KIT)) ?? '';
      await files.write(kitCurrentRecordPath(KIT), record.replace(/"listHash": "[0-9a-f]+"/, '"listHash": "abc"'));
      assert.equal(await readKitCurrent(files, KIT), undefined);
    });
  });

  describe('pruneKitVersions', () => {
    it('keeps current, every newer version and the two before current, and removes the rest', async () => {
      for (const version of ['0.507.0', '0.508.0', '0.509.0', '0.510.0', '0.511.0']) {
        await install(version);
      }
      assert.deepEqual(await listKitVersions(files, KIT), ['0.511.0', '0.510.0', '0.509.0']);
      await useKitVersion({ files, tree, kitHome: KIT }, { kind: 'version', version: '0.509.0' });
      assert.deepEqual(await pruneKitVersions({ files, tree, kitHome: KIT }), { removed: [], failed: [] });
      assert.equal(files.get(join(KIT, 'versions', '0.507.0.source.json')), undefined);
    });

    it('removes nothing with no version in use', async () => {
      await files.write(join(kitVersionFolder(KIT, '0.400.0'), 'x'), 'x');
      assert.deepEqual(await pruneKitVersions({ files, tree, kitHome: KIT }), { removed: [], failed: [] });
    });
  });
});
