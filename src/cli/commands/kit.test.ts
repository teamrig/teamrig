import assert from 'node:assert/strict';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { settingsWriteRefusal } from '../../core/settings-writers.ts';
import { KIT_VERSION } from '../../core/version.ts';
import { hookLauncherProblem } from '../../kit/hook-launcher.ts';
import { kitInstallLockPath } from '../../kit/kit-self-install.ts';
import { KIT_LOCK_BUSY, kitCurrentPath, kitVersionFolder, readKitCurrent } from '../../kit/kit-versions.ts';
import { CliHarness, KIT, type RunOptions } from '../../testing/cli-harness.ts';
import { holderLetsGo, holdFileLock } from '../../testing/held-file-lock.ts';
import { writeKeptKitVersion, writeKitRelease } from '../../testing/kit-release.ts';
import { cliLauncherPath, KIT_LAUNCHER_FILE } from '../../restore/cli-launcher.ts';
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

    it('names the write that gets a damaged version copied again, which only --yes does (T5522)', async () => {
      await keptWith('0.509.0');
      const record = join(KIT, 'versions', '0.507.0.source.json');
      await kit.files.write(join(kitVersionFolder(KIT, '0.507.0'), 'dist', 'cli', 'main.js'), 'patched\n');
      const preview = await kit.run(['kit', 'use', '0.507.0'], options);
      assert.equal(preview.code, EXIT.refused);
      assert.match(preview.stdout[0] ?? '', /with --yes, teamrig kit use drops its source record, so the next session start/u);
      assert.notEqual(await kit.files.read(record), undefined);
      const written = await kit.run(['kit', 'use', '0.507.0', '--yes'], options);
      assert.equal(written.code, EXIT.refused);
      assert.match(written.stdout[0] ?? '', /its source record is dropped, so the next session start/u);
      assert.equal(await kit.files.read(record), undefined);
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

    it('exits failed with a NOTE naming a version a running process holds, removing the rest', async () => {
      const tree = new MemoryKitTree(kit.files);
      await keptWith('0.509.0');
      tree.heldFolders.add(kitVersionFolder(KIT, '0.505.0'));
      const result = await kit.run(['kit', 'prune', '--yes'], { ...options, kitTree: tree });
      assert.deepEqual(
        [result.code, result.stdout],
        [EXIT.failed, ['REMOVED 1: 0.506.0', 'NOTE left for the next prune, a running process holds a file: 0.505.0']],
      );
      assert.ok(kit.files.get(join(kitVersionFolder(KIT, '0.505.0'), '.claude-plugin', 'plugin.json')) !== undefined);
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

  describe('kit install', () => {
    /** The running teamrig: a release clone with this version's built client and its kit launcher. */
    const CLONE = join('/', 'srv', 'install', 'teamrig', 'plugins', 'teamrig');
    const SELF = { self: { node: '/usr/bin/node', script: join(CLONE, 'dist', 'cli', 'main.js'), execArgv: [] } };
    const LAUNCHER = '// the kit launcher of this release\n';
    const COMMIT = 'c'.repeat(40);
    const release = ['--tag', `v${KIT_VERSION}`, '--commit', COMMIT];

    beforeEach(async () => {
      await writeKitRelease(kit.files, CLONE, KIT_VERSION);
      await kit.files.write(join(CLONE, KIT_LAUNCHER_FILE), LAUNCHER);
      options = { ...options, ...SELF };
    });

    it('shows the copy and writes nothing without --yes', async () => {
      const result = await kit.run(['kit', 'install', ...release], options);
      assert.equal(result.code, EXIT.ok);
      assert.match(result.stdout.join('\n'), new RegExp(`^PREVIEW nothing written .*github-release v${KIT_VERSION} ${COMMIT}.*current no version -> ${KIT_VERSION}`, 'u'));
      assert.deepEqual([kit.files.get(kitCurrentPath(KIT)), kit.files.get(cliLauncherPath(KIT))], [undefined, undefined]);
    });

    it('copies the clone in as the named release, names it current and writes the kit launcher a hook line runs', async () => {
      const result = await kit.run(['kit', 'install', ...release, '--yes'], options);
      assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
      assert.deepEqual(result.stdout, [
        `WROTE current ${KIT_VERSION}: teamrig ${KIT_VERSION} (github-release v${KIT_VERSION} ${COMMIT})`,
        `WROTE ${cliLauncherPath(KIT)}: the kit launcher of teamrig ${KIT_VERSION}`,
      ]);
      assert.deepEqual((await readKitCurrent(kit.files, KIT))?.source, { kind: 'github-release', tag: `v${KIT_VERSION}`, commit: COMMIT });
      assert.equal(kit.files.get(cliLauncherPath(KIT)), LAUNCHER);
      assert.equal(await hookLauncherProblem(kit.files, KIT), undefined);
    });

    it('changes nothing on a second run', async () => {
      await kit.run(['kit', 'install', ...release, '--yes'], options);
      const again = await kit.run(['kit', 'install', ...release, '--yes'], options);
      assert.deepEqual(
        [again.code, again.stdout],
        [EXIT.ok, [`UNCHANGED current ${KIT_VERSION} is installed already`, `UNCHANGED ${cliLauncherPath(KIT)}: the kit launcher of teamrig ${KIT_VERSION}`]],
      );
    });

    it('keeps a pinned current, naming the pin, and writes the launcher the pinned version ships', async () => {
      await keptWith('0.507.0');
      await kit.files.write(join(kitVersionFolder(KIT, '0.507.0'), KIT_LAUNCHER_FILE), '// 0.507.0 launcher\n');
      const result = await kit.run(['kit', 'install', ...release, '--yes'], options);
      assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
      assert.match(result.stdout[0] ?? '', /^NOTE teamrig pinned at 0\.507\.0; /u);
      assert.equal(kit.files.get(kitCurrentPath(KIT)), '0.507.0\n');
      assert.equal(kit.files.get(cliLauncherPath(KIT)), '// 0.507.0 launcher\n');
    });

    it('fails naming the launcher when the current version ships none', async () => {
      await keptWith('0.507.0');
      const result = await kit.run(['kit', 'install', ...release, '--yes'], options);
      assert.equal(result.code, EXIT.failed);
      assert.match(result.stdout.at(-1) ?? '', /^NOTE the kit launcher is not written: teamrig 0\.507\.0 in the kit home ships no /u);
    });

    it('refuses a client with no integrity list, writing nothing', async () => {
      const source = join('/', 'srv', 'src', 'teamrig', 'plugins', 'teamrig');
      const result = await kit.run(['kit', 'install', ...release, '--yes'], { ...options, self: { node: '/usr/bin/node', script: join(source, 'dist', 'cli', 'main.js'), execArgv: [] } });
      assert.equal(result.code, EXIT.refused);
      assert.match(result.stdout[0] ?? '', /^REFUSED teamrig kit install: .* holds no integrity list/u);
      assert.equal(kit.files.get(kitCurrentPath(KIT)), undefined);
    });

    it('refuses a tag that is not this teamrig version and a commit that is not 40 hex characters', async () => {
      const wrongTag = await kit.run(['kit', 'install', '--tag', 'v0.400.0', '--commit', COMMIT, '--yes'], options);
      const shortCommit = await kit.run(['kit', 'install', '--tag', `v${KIT_VERSION}`, '--commit', 'abc123', '--yes'], options);
      const noCommit = await kit.run(['kit', 'install', '--tag', `v${KIT_VERSION}`], options);
      assert.deepEqual([wrongTag.code, shortCommit.code, noCommit.code], [EXIT.usage, EXIT.usage, EXIT.usage]);
      assert.equal(kit.files.get(kitCurrentPath(KIT)), undefined);
    });

    it('refuses its write where Claude Code runs it', async () => {
      const result = await kit.run(['kit', 'install', ...release, '--yes'], { ...options, env: { CLAUDECODE: '1' } });
      assert.deepEqual(result.stdout, [`REFUSED ${settingsWriteRefusal('kit install', 'CLAUDECODE')}`]);
    });

    it('refuses, writing nothing, while another process holds the install lock past the wait', async () => {
      await holdFileLock(kit, LOCK);
      const result = await kit.run(['kit', 'install', ...release, '--yes'], options);
      assert.deepEqual([result.code, result.stdout], [EXIT.refused, [`REFUSED teamrig kit install: ${KIT_LOCK_BUSY}`]]);
    });
  });
});
