import assert from 'node:assert/strict';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { settingsWriteRefusal } from '../../core/settings-writers.ts';
import { kitCurrentPath, kitVersionFolder, readKitCurrent } from '../../kit/kit-versions.ts';
import { CliHarness, KIT, type RunOptions } from '../../testing/cli-harness.ts';
import { writeKeptKitVersion } from '../../testing/kit-release.ts';
import { MemoryKitTree } from '../../testing/memory-kit-tree.ts';
import { EXIT } from '../runtime.ts';

const KEPT = ['0.505.0', '0.506.0', '0.507.0', '0.508.0', '0.509.0'];

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
  });
});
