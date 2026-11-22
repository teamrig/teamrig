import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeExecutables, FakeUserPath } from '../testing/fake-restore.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { CLI_LAUNCHER_SCRIPT, CMD_SHIM_SCRIPT, cliLauncherFolder, cliLauncherPath, cmdShimPath, SH_SHIM_SCRIPT, shShimPath } from './cli-launcher.ts';
import { cliOnPathSteps, nodeMarkExecutable, type CliOnPath } from './cli-on-path.ts';

const KIT = join('/', 'srv', 'pat', '.teamrig');
const BIN = cliLauncherFolder(KIT);

interface World {
  readonly files: MemoryFiles;
  readonly userPath: FakeUserPath;
  readonly executables: FakeExecutables;
  readonly cli: CliOnPath;
}

function worldOf(platform: NodeJS.Platform, files: Readonly<Record<string, string>> = {}, folders: readonly string[] = []): World {
  const memory = new MemoryFiles(files);
  const userPath = new FakeUserPath(folders);
  const executables = new FakeExecutables();
  return { files: memory, userPath, executables, cli: { files: memory, kitHome: KIT, platform, userPath, markExecutable: executables.mark } };
}

async function takeAll(steps: ReadonlyArray<{ readonly act: () => Promise<void> }>): Promise<void> {
  for (const step of steps) {
    await step.act();
  }
}

const PATH_LINE = `ADD ${BIN} to the user's PATH (${new FakeUserPath().where}), so terminals opened from now on run teamrig`;

describe('cliOnPathSteps (T5095)', () => {
  it('writes the Node launcher and the sh shim, then adds the bin folder to the PATH last, off Windows', async () => {
    const { files, userPath, executables, cli } = worldOf('linux');
    const steps = await cliOnPathSteps(cli);
    assert.deepEqual(steps.map((step) => step.line), [`WRITE ${cliLauncherPath(KIT)}`, `WRITE ${shShimPath(KIT)}`, PATH_LINE]);
    assert.deepEqual([files.get(cliLauncherPath(KIT)), userPath.folders], [undefined, []]);
    await takeAll(steps);
    assert.deepEqual([files.get(cliLauncherPath(KIT)), files.get(shShimPath(KIT)), files.get(cmdShimPath(KIT))], [CLI_LAUNCHER_SCRIPT, SH_SHIM_SCRIPT, undefined]);
    assert.deepEqual([userPath.folders, executables.marked], [[BIN], [shShimPath(KIT)]]);
  });

  it('also writes the cmd shim on Windows, marking only the sh shim a program', async () => {
    const { files, executables, cli } = worldOf('win32');
    const steps = await cliOnPathSteps(cli);
    assert.deepEqual(steps.map((step) => step.line), [`WRITE ${cliLauncherPath(KIT)}`, `WRITE ${shShimPath(KIT)}`, `WRITE ${cmdShimPath(KIT)}`, PATH_LINE]);
    await takeAll(steps);
    assert.deepEqual([files.get(cmdShimPath(KIT)), executables.marked], [CMD_SHIM_SCRIPT, [shShimPath(KIT)]]);
  });

  it('takes no step when every launcher is current and the PATH holds the folder', async () => {
    const current = { [cliLauncherPath(KIT)]: CLI_LAUNCHER_SCRIPT, [shShimPath(KIT)]: SH_SHIM_SCRIPT };
    assert.deepEqual(await cliOnPathSteps(worldOf('linux', current, [BIN]).cli), []);
  });

  it('rewrites an old launcher and leaves a PATH that holds the folder alone', async () => {
    const { files, cli } = worldOf('linux', { [cliLauncherPath(KIT)]: '// older\n', [shShimPath(KIT)]: SH_SHIM_SCRIPT }, [BIN]);
    const steps = await cliOnPathSteps(cli);
    assert.deepEqual(steps.map((step) => step.line), [`WRITE ${cliLauncherPath(KIT)}`]);
    await takeAll(steps);
    assert.equal(files.get(cliLauncherPath(KIT)), CLI_LAUNCHER_SCRIPT);
  });

  it('adds the folder to a PATH that lacks it though the launchers are current', async () => {
    const { userPath, cli } = worldOf('linux', { [cliLauncherPath(KIT)]: CLI_LAUNCHER_SCRIPT, [shShimPath(KIT)]: SH_SHIM_SCRIPT });
    const steps = await cliOnPathSteps(cli);
    assert.deepEqual(steps.map((step) => step.line), [PATH_LINE]);
    await takeAll(steps);
    assert.deepEqual(userPath.folders, [BIN]);
  });

  it('fails the PATH step with the error the PATH gave', async () => {
    const { userPath, cli } = worldOf('linux', { [cliLauncherPath(KIT)]: CLI_LAUNCHER_SCRIPT, [shShimPath(KIT)]: SH_SHIM_SCRIPT });
    userPath.failWith = 'registry access denied';
    const [step] = await cliOnPathSteps(cli);
    assert.ok(step !== undefined);
    await assert.rejects(step.act(), /registry access denied/);
  });
});

describe('nodeMarkExecutable', () => {
  it('marks nothing on Windows, which has no such mark', async () => {
    await nodeMarkExecutable('win32')(join(KIT, 'no-such-file'));
  });

  it('lets the owner read, write and run the file, and others read and run it, elsewhere', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'teamrig-mark-'));
    try {
      const shim = join(folder, 'teamrig');
      writeFileSync(shim, SH_SHIM_SCRIPT, { mode: 0o644 });
      await nodeMarkExecutable('linux')(shim);
      // Windows keeps only a read-only flag, so the mode bits are read where the system keeps them.
      if (process.platform !== 'win32') {
        assert.equal(statSync(shim).mode & 0o777, 0o755);
      }
      await assert.rejects(nodeMarkExecutable('linux')(join(folder, 'missing')), /ENOENT/);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
