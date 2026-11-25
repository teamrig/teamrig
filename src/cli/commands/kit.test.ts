import assert from 'node:assert/strict';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { settingsWriteRefusal } from '../../core/settings-writers.ts';
import { kitInstallLockPath } from '../../kit/kit-self-install.ts';
import { KIT_LOCK_BUSY, kitCurrentPath, kitVersionFolder, readKitCurrent } from '../../kit/kit-versions.ts';
import { CliHarness, KIT, type RunOptions } from '../../testing/cli-harness.ts';
import { holderLetsGo, holdFileLock } from '../../testing/held-file-lock.ts';
import { writeKeptKitVersion } from '../../testing/kit-release.ts';
import { MemoryKitTree } from '../../testing/memory-kit-tree.ts';
import { EXIT } from '../runtime.ts';

const KEPT = ['0.505.0', '0.506.0', '0.507.0', '0.508.0', '0.509.0'];
const LOCK = kitInstallLockPath(KIT);

describe('teamrig kit', () => {
  let kit: CliHarness;
  let options: RunOptions;

  /** Keeps every version of KEPT in the kit home and runs `use` once with --yes, so `current` names `version`. */
  async function keptWith(version: string): Promise<void> {
    for (const kept of KEPT) {
      await writeKeptKitVersion(kit.files, KIT, kept);
    }
    const result = await kit.run(['kit', 'use', version, '--yes'], options);
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
  }

  beforeEach(() => {
    kit = new CliHarness();
    options = { kitTree: new MemoryKitTree(kit.files) };
  });

  describe('kit versions', () => {
    it('says no version is installed in an empty kit home', async () => {
      const result = await kit.run(['kit', 'versions'], options);
      assert.equal(result.code, EXIT.ok);
      assert.deepEqual(result.stdout, [`no teamrig version is installed in ${KIT}; a session start of the teamrig plugin installs one`]);
    });

    it('lists the kept versions newest first, marking current, its pin and those past the rollback window', async () => {
      await keptWith('0.508.0');
      const result = await kit.run(['kit', 'versions'], options);
      assert.deepEqual(result.stdout, ['0.509.0', '0.508.0  current, pinned  claude-code-plugin', '0.507.0', '0.506.0', '0.505.0  past the rollback window']);
    });

    it('notes a kit home whose records name no current version', async () => {
      await keptWith('0.509.0');
      await kit.files.write(kitCurrentPath(KIT), '../evil\n');
      const result = await kit.run(['kit', 'versions'], options);
      assert.equal(result.stdout.length, KEPT.length + 1);
      assert.match(result.stdout.at(-1) ?? '', /^NOTE no version is current: .*teamrig kit use --latest/u);
    });
  });

  describe('kit use', () => {
    it('previews the move without --yes and writes nothing', async () => {
      await keptWith('0.509.0');
      const before = kit.files.get(kitCurrentPath(KIT));
      const result = await kit.run(['kit', 'use', '0.507.0'], options);
      assert.equal(result.code, EXIT.ok);
      assert.deepEqual(result.stdout, ['PREVIEW nothing written (add --yes to write): current 0.509.0 -> 0.507.0, pinned']);
      assert.equal(kit.files.get(kitCurrentPath(KIT)), before);
    });

    it('moves current to a named version and pins it', async () => {
      await keptWith('0.509.0');
      const result = await kit.run(['kit', 'use', '0.507.0', '--yes'], options);
      assert.equal(result.code, EXIT.ok);
      assert.match(result.stdout[0] ?? '', /^WROTE current 0\.507\.0 \(was 0\.509\.0\), pinned: /u);
      const current = await readKitCurrent(kit.files, KIT);
      assert.equal(current?.version, '0.507.0');
      assert.equal(current?.pinned, true);
    });

    it('--latest moves to the newest kept version and clears the pin', async () => {
      await keptWith('0.506.0');
      const result = await kit.run(['kit', 'use', '--latest', '--yes'], options);
      assert.match(result.stdout[0] ?? '', /^WROTE current 0\.509\.0 \(was 0\.506\.0\), no pin$/u);
      assert.equal((await readKitCurrent(kit.files, KIT))?.pinned, false);
    });

    it('refuses a version that is not kept, and one whose files changed, moving nothing', async () => {
      await keptWith('0.509.0');
      const missing = await kit.run(['kit', 'use', '0.400.0', '--yes'], options);
      assert.equal(missing.code, EXIT.refused);
      assert.match(missing.stdout[0] ?? '', /0\.400\.0 is not installed; kept: 0\.509\.0, /u);
      await kit.files.write(join(kitVersionFolder(KIT, '0.507.0'), 'dist', 'cli', 'main.js'), 'patched\n');
      const damaged = await kit.run(['kit', 'use', '0.507.0'], options);
      assert.equal(damaged.code, EXIT.refused);
      assert.match(damaged.stdout[0] ?? '', /0\.507\.0 is damaged/u);
      assert.equal((await readKitCurrent(kit.files, KIT))?.version, '0.509.0');
    });

    it('takes one version or --latest, never both nor neither', async () => {
      for (const argv of [['kit', 'use'], ['kit', 'use', '0.507.0', '--latest'], ['kit', 'use', '0.507.0', '0.508.0']]) {
        assert.equal((await kit.run(argv, options)).code, EXIT.usage, argv.join(' '));
      }
    });

    it("waits for a session start's install to let go of the install lock before it checks and writes", async () => {
      await keptWith('0.509.0');
      await holdFileLock(kit, LOCK);
      const seen: Array<string | undefined> = [];
      const result = await kit.run(['kit', 'use', '0.507.0', '--yes'], { ...options, sleep: holderLetsGo(kit, LOCK, kitCurrentPath(KIT), seen) });
      assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
      assert.deepEqual([seen, kit.files.get(kitCurrentPath(KIT)), kit.files.get(LOCK)], [['0.509.0\n'], '0.507.0\n', undefined]);
    });

    it('refuses, moving nothing, while another process holds the install lock past the wait', async () => {
      await keptWith('0.509.0');
      await holdFileLock(kit, LOCK);
      const result = await kit.run(['kit', 'use', '0.507.0', '--yes'], options);
      assert.deepEqual([result.code, result.stdout], [EXIT.refused, [`REFUSED teamrig kit use: ${KIT_LOCK_BUSY}`]]);
      assert.equal((await readKitCurrent(kit.files, KIT))?.version, '0.509.0');
    });

    it('takes no lock for a preview, so an install in progress never holds it up', async () => {
      await keptWith('0.509.0');
      await holdFileLock(kit, LOCK);
      const result = await kit.run(['kit', 'use', '0.507.0'], options);
      assert.deepEqual([result.code, kit.clock.sleeps], [EXIT.ok, []]);
    });

    it("refuses the write where an agent's host runs it, as a settings writer", async () => {
      await keptWith('0.509.0');
      const result = await kit.run(['kit', 'use', '0.507.0', '--yes'], { ...options, env: { CLAUDECODE: '1' } });
      assert.equal(result.code, EXIT.refused);
      assert.deepEqual(result.stdout, [`REFUSED ${settingsWriteRefusal('kit use', 'CLAUDECODE')}`]);
      assert.equal((await readKitCurrent(kit.files, KIT))?.version, '0.509.0');
    });
  });

  describe('kit prune', () => {
    it('names the versions past the rollback window without --yes, and removes them with it', async () => {
      await keptWith('0.509.0');
      const preview = await kit.run(['kit', 'prune'], options);
      assert.deepEqual(preview.stdout, ['PREVIEW nothing removed (add --yes to remove): removed 2: 0.506.0, 0.505.0']);
      assert.ok(kit.files.get(join(kitVersionFolder(KIT, '0.505.0'), '.claude-plugin', 'plugin.json')) !== undefined);
      const result = await kit.run(['kit', 'prune', '--yes'], options);
      assert.equal(result.code, EXIT.ok);
      assert.deepEqual(result.stdout, ['REMOVED 2: 0.506.0, 0.505.0']);
      assert.equal(kit.files.get(join(kitVersionFolder(KIT, '0.505.0'), '.claude-plugin', 'plugin.json')), undefined);
    });

    it('names and removes what stopped installs left, each on its own line', async () => {
      await keptWith('0.509.0');
      await kit.files.write(join(KIT, 'versions', '0.510.0.partial', 'x'), 'x\n');
      await kit.files.write(join(KIT, 'current.4242.1.tmp'), 'x\n');
      const leftovers = `2: ${join('versions', '0.510.0.partial')}, current.4242.1.tmp`;
      const preview = await kit.run(['kit', 'prune'], options);
      assert.deepEqual(preview.stdout, ['PREVIEW nothing removed (add --yes to remove): removed 2: 0.506.0, 0.505.0', `PREVIEW leftovers of stopped installs ${leftovers}`]);
      const result = await kit.run(['kit', 'prune', '--yes'], options);
      assert.equal(result.code, EXIT.ok);
      assert.deepEqual(result.stdout, ['REMOVED 2: 0.506.0, 0.505.0', `REMOVED leftovers of stopped installs ${leftovers}`]);
      assert.equal(kit.files.get(join(KIT, 'current.4242.1.tmp')), undefined);
    });

    it("waits for a session start's install to let go of the install lock before it removes anything", async () => {
      await keptWith('0.509.0');
      await holdFileLock(kit, LOCK);
      const oldest = join(kitVersionFolder(KIT, '0.505.0'), '.claude-plugin', 'plugin.json');
      const seen: Array<string | undefined> = [];
      const result = await kit.run(['kit', 'prune', '--yes'], { ...options, sleep: holderLetsGo(kit, LOCK, oldest, seen) });
      assert.deepEqual([result.code, result.stdout], [EXIT.ok, ['REMOVED 2: 0.506.0, 0.505.0']]);
      assert.deepEqual([seen.map((text) => text !== undefined), kit.files.get(oldest)], [[true], undefined]);
    });

    it('refuses, removing nothing, while another process holds the install lock past the wait', async () => {
      await keptWith('0.509.0');
      await holdFileLock(kit, LOCK);
      const result = await kit.run(['kit', 'prune', '--yes'], options);
      assert.deepEqual([result.code, result.stdout], [EXIT.refused, [`REFUSED teamrig kit prune: ${KIT_LOCK_BUSY}`]]);
      assert.ok(kit.files.get(join(kitVersionFolder(KIT, '0.505.0'), '.claude-plugin', 'plugin.json')) !== undefined);
    });
  });
});
