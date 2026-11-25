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

/** Files whose move to one path throws, as a held file or a full disk would at the step that puts a copy in place. */
class FailingMoveFiles extends MemoryFiles {
  failMoveTo: string | undefined;

  override async move(from: string, to: string): Promise<boolean> {
    if (to === this.failMoveTo) {
      this.failMoveTo = undefined;
      throw new Error('EBUSY: resource busy or locked');
    }
    return super.move(from, to);
  }
}

describe('kit versions', () => {
  let files: FailingMoveFiles;
  let tree: MemoryKitTree;
  const install = (version: string, overrides: Partial<KitInstall> = {}): Promise<KitInstallOutcome> =>
    installKitVersion({ files, tree, kitHome: KIT, from: join(PLUGIN, version), version, source: SOURCE, lock: new InlineMutex(), ...overrides });

  beforeEach(async () => {
    files = new FailingMoveFiles();
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

    it('copies the version in use again when its kept list changed, never trusting the record alone', async () => {
      await install('0.508.0');
      await files.write(join(kitVersionFolder(KIT, '0.508.0'), CLIENT_MANIFEST), '{}\n');
      assert.deepEqual(await install('0.508.0'), { kind: 'current', version: '0.508.0' });
      assert.equal(tree.copies.length, 2);
      assert.equal(files.get(join(kitVersionFolder(KIT, '0.508.0'), CLIENT_MANIFEST)), files.get(join(PLUGIN, '0.508.0', CLIENT_MANIFEST)));
    });

    it('settles a pinned or older start without the lock, so another start copying never makes it busy', async () => {
      await install('0.508.0');
      await install('0.509.0');
      assert.deepEqual(await install('0.508.0', { lock: new BusyMutex() }), { kind: 'older', version: '0.508.0', current: '0.509.0' });
      await useKitVersion({ files, kitHome: KIT }, { kind: 'version', version: '0.508.0' });
      assert.deepEqual(await install('0.509.0', { lock: new BusyMutex() }), { kind: 'pinned', version: '0.509.0', pinned: '0.508.0' });
      assert.deepEqual(await install('0.508.0', { lock: new BusyMutex() }), { kind: 'current', version: '0.508.0' });
      assert.equal(tree.copies.length, 2);
    });

    it('replaces a damaged kept version by moves, leaving no aside copy behind', async () => {
      await install('0.508.0');
      await files.write(join(kitVersionFolder(KIT, '0.508.0'), CLIENT_MANIFEST), '{}\n');
      assert.deepEqual(await install('0.508.0'), { kind: 'current', version: '0.508.0' });
      assert.equal(files.get(join(kitVersionFolder(KIT, '0.508.0'), CLIENT_MANIFEST)), files.get(join(PLUGIN, '0.508.0', CLIENT_MANIFEST)));
      assert.deepEqual(await files.list(join(KIT, 'versions')), ['0.508.0', '0.508.0.source.json']);
    });

    it('puts the old folder back when the whole copy cannot move in, and moves nothing', async () => {
      await install('0.508.0');
      await files.write(join(kitVersionFolder(KIT, '0.508.0'), CLIENT_MANIFEST), '{}\n');
      const record = files.get(kitCurrentRecordPath(KIT));
      files.failMoveTo = kitVersionFolder(KIT, '0.508.0');
      const outcome = await install('0.508.0');
      assert.deepEqual(outcome, { kind: 'refused', why: 'copying 0.508.0 failed: EBUSY: resource busy or locked' });
      assert.equal(files.get(join(kitVersionFolder(KIT, '0.508.0'), CLIENT_MANIFEST)), '{}\n');
      assert.equal(files.get(kitCurrentRecordPath(KIT)), record);
      assert.deepEqual(await files.list(join(KIT, 'versions')), ['0.508.0', '0.508.0.source.json']);
    });

    it('refuses a version that is no release version, a path above all', async () => {
      assert.deepEqual(await install('../x'), { kind: 'refused', why: '../x is no release version' });
      assert.equal(tree.copies.length, 0);
    });

    it('records where a kept version came from with the hash of the list it was copied with', async () => {
      await install('0.508.0');
      const listHash = clientFileHash(files.get(join(PLUGIN, '0.508.0', CLIENT_MANIFEST)) ?? '');
      assert.deepEqual(JSON.parse(files.get(join(KIT, 'versions', '0.508.0.source.json')) ?? ''), { source: SOURCE, listHash });
    });

    it('writes a missing source record again for a kept copy of the same build', async () => {
      await install('0.508.0');
      await install('0.509.0');
      const source = join(KIT, 'versions', '0.508.0.source.json');
      const record = files.get(source);
      await files.remove(source);
      assert.deepEqual(await install('0.508.0'), { kind: 'older', version: '0.508.0', current: '0.509.0' });
      assert.deepEqual([files.get(source), tree.copies.length], [record, 2]);
    });

    it('refuses a release of a kept version from another build, current or not, and moves nothing', async () => {
      const other = '/home/user/other-build';
      await writeKitRelease(files, other, '0.508.0', "export const v = '0.508.0'; // build B\n");
      await install('0.508.0');
      const refused = { kind: 'refused', why: `0.508.0 is kept from another build than the running client (its ${CLIENT_MANIFEST} differs)` };
      const record = files.get(kitCurrentRecordPath(KIT));
      assert.deepEqual(await install('0.508.0', { from: other }), refused);
      assert.equal(files.get(kitCurrentRecordPath(KIT)), record);
      await install('0.509.0');
      assert.deepEqual(await install('0.508.0', { from: other }), refused);
      assert.equal(files.get(join(kitVersionFolder(KIT, '0.508.0'), 'dist', 'cli', 'main.js')), kitReleaseMain('0.508.0'));
      assert.equal((await readKitCurrent(files, KIT))?.version, '0.509.0');
    });

    it('moves nothing and keeps the pin when only one record is there or they name different versions', async () => {
      const refused: KitInstallOutcome = {
        kind: 'refused',
        why: 'the records naming the version in use disagree or one is missing; teamrig kit use <version> names one',
      };
      await install('0.508.0');
      await install('0.509.0');
      await useKitVersion({ files, kitHome: KIT }, { kind: 'version', version: '0.508.0' });
      const record = files.get(kitCurrentRecordPath(KIT)) ?? '';
      const cases: ReadonlyArray<readonly [string, () => Promise<void>]> = [
        ['only current', () => files.remove(kitCurrentRecordPath(KIT))],
        ['only current.json', () => files.remove(kitCurrentPath(KIT))],
        ['a mismatch', () => files.write(kitCurrentPath(KIT), '0.509.0\n')],
      ];
      for (const [name, damage] of cases) {
        await files.write(kitCurrentPath(KIT), '0.508.0\n');
        await files.write(kitCurrentRecordPath(KIT), record);
        await damage();
        const line = files.get(kitCurrentPath(KIT));
        const json = files.get(kitCurrentRecordPath(KIT));
        assert.deepEqual(await install('0.510.0'), refused, name);
        assert.deepEqual([files.get(kitCurrentPath(KIT)), files.get(kitCurrentRecordPath(KIT))], [line, json], name);
        assert.deepEqual(await listKitVersions(files, KIT), ['0.509.0', '0.508.0'], name);
      }
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
      assert.deepEqual(await useKitVersion({ files, kitHome: KIT }, { kind: 'version', version: '0.508.0' }), {
        kind: 'moved',
        version: '0.508.0',
        previous: '0.509.0',
        pinned: true,
      });
      assert.deepEqual(await install('0.510.0'), { kind: 'pinned', version: '0.510.0', pinned: '0.508.0' });
      assert.equal((await readKitCurrent(files, KIT))?.version, '0.508.0');
      assert.deepEqual(await listKitVersions(files, KIT), ['0.510.0', '0.508.0']);
    });

    it('use --latest moves to the newest kept version and clears the pin', async () => {
      await install('0.508.0');
      await install('0.509.0');
      await useKitVersion({ files, kitHome: KIT }, { kind: 'version', version: '0.508.0' });
      await install('0.510.0');
      assert.deepEqual(await useKitVersion({ files, kitHome: KIT }, { kind: 'latest' }), {
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
        why: `0.508.0 is damaged (files do not match ${CLIENT_MANIFEST}: package.json); a session start of the teamrig plugin at that version copies it again`,
      });
      assert.equal((await readKitCurrent(files, KIT))?.version, '0.509.0');
    });

    it('refuses a kept version with no source record, or one that names another build, and moves nothing', async () => {
      await install('0.508.0');
      await install('0.509.0');
      const source = join(KIT, 'versions', '0.508.0.source.json');
      const record = files.get(source) ?? '';
      await files.remove(source);
      assert.deepEqual(await useKitVersion({ files, kitHome: KIT }, { kind: 'version', version: '0.508.0' }), {
        kind: 'refused',
        why: '0.508.0 has no record of where it came from (0.508.0.source.json); a session start of the teamrig plugin at that version copies it again',
      });
      await files.write(source, record.replace(/"listHash":"[0-9a-f]+"/, `"listHash":"${'0'.repeat(64)}"`));
      assert.deepEqual(await useKitVersion({ files, kitHome: KIT }, { kind: 'version', version: '0.508.0' }), {
        kind: 'refused',
        why: `0.508.0 is not the build it was copied from (its ${CLIENT_MANIFEST} differs)`,
      });
      assert.equal((await readKitCurrent(files, KIT))?.version, '0.509.0');
    });

    it('refuses with no version installed', async () => {
      assert.equal((await useKitVersion({ files, kitHome: KIT }, { kind: 'latest' })).kind, 'refused');
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
    it('keeps current, the two before current and the newest newer one, and removes the rest', async () => {
      for (const version of ['0.507.0', '0.508.0', '0.509.0', '0.510.0', '0.511.0']) {
        await install(version);
      }
      assert.deepEqual(await listKitVersions(files, KIT), ['0.511.0', '0.510.0', '0.509.0']);
      assert.equal(files.get(join(KIT, 'versions', '0.507.0.source.json')), undefined);
      await useKitVersion({ files, kitHome: KIT }, { kind: 'version', version: '0.509.0' });
      assert.deepEqual(await pruneKitVersions({ files, tree, kitHome: KIT }), { removed: ['0.510.0'], leftovers: [], failed: [] });
      assert.deepEqual(await listKitVersions(files, KIT), ['0.511.0', '0.509.0']);
      await writeKitRelease(files, join(PLUGIN, '0.512.0'), '0.512.0');
      assert.deepEqual(await install('0.512.0'), { kind: 'pinned', version: '0.512.0', pinned: '0.509.0' });
      assert.deepEqual(await listKitVersions(files, KIT), ['0.512.0', '0.509.0']);
      assert.equal(files.get(join(KIT, 'versions', '0.511.0.source.json')), undefined);
    });

    it('removes nothing with no version in use', async () => {
      await files.write(join(kitVersionFolder(KIT, '0.400.0'), 'x'), 'x');
      assert.deepEqual(await pruneKitVersions({ files, tree, kitHome: KIT }), { removed: [], leftovers: [], failed: [] });
    });

    it("removes a stopped install's folders and temp files, and nothing else in the kit home", async () => {
      await install('0.508.0');
      const stray = [
        join('versions', '0.509.0.partial', 'dist', 'cli', 'main.js'),
        join('versions', '0.508.0.replaced', 'dist', 'cli', 'main.js'),
        join('versions', '0.508.0.source.json.4242.1.tmp'),
        'current.4242.2.tmp',
        'current.json.4242.3.tmp',
      ];
      const kept = [join('versions', 'notes.partial', 'x'), 'settings.json.4242.1.tmp', 'current.json'];
      for (const path of [...stray, join('versions', 'notes.partial', 'x'), 'settings.json.4242.1.tmp']) {
        await files.write(join(KIT, path), 'x\n');
      }
      const outcome = await pruneKitVersions({ files, tree, kitHome: KIT });
      assert.deepEqual(outcome.leftovers, [
        join('versions', '0.508.0.replaced'),
        join('versions', '0.508.0.source.json.4242.1.tmp'),
        join('versions', '0.509.0.partial'),
        'current.4242.2.tmp',
        'current.json.4242.3.tmp',
      ]);
      assert.deepEqual(
        stray.map((path) => files.get(join(KIT, path))),
        stray.map(() => undefined),
      );
      assert.ok(kept.every((path) => files.get(join(KIT, path)) !== undefined));
      assert.equal((await readKitCurrent(files, KIT))?.version, '0.508.0');
    });
  });
});
