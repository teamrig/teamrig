import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { kitCurrentPath, kitVersionFolder } from './kit-versions.ts';
import { ENTRY_FLAG, EVENT_FLAG, LAUNCHER_ENTRIES } from './launcher.ts';
import { hookLauncher, hookLauncherProblem, syncKitLauncher } from './hook-launcher.ts';
import { cliLauncherPath, KIT_LAUNCHER_FILE } from '../restore/cli-launcher.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { SEEDED_LAUNCHER_TEXT, seedKitHome } from '../testing/kit-home.ts';

const KIT_HOME = join('/', 'srv', 'ada', '.teamrig');
const VERSION = '0.510.0';

async function seeded(): Promise<MemoryFiles> {
  const files = new MemoryFiles();
  await seedKitHome(files, KIT_HOME, VERSION);
  return files;
}

describe('hookLauncher', () => {
  it('names the launcher on PATH and the words it reads', () => {
    const launcher = hookLauncher(KIT_HOME);
    assert.equal(launcher.path, cliLauncherPath(KIT_HOME));
    assert.equal(launcher.entryFlag, ENTRY_FLAG);
    assert.equal(launcher.eventFlag, EVENT_FLAG);
  });

  it("maps each entry script to the launcher's word for it, so a line names only entries the launcher runs", () => {
    const { entries } = hookLauncher(KIT_HOME);
    assert.equal(entries.size, LAUNCHER_ENTRIES.size);
    for (const [word, script] of LAUNCHER_ENTRIES) {
      assert.equal(entries.get(script), word);
    }
  });
});

describe('hookLauncherProblem', () => {
  it('finds none in a kit home a session start left current and intact', async () => {
    assert.equal(await hookLauncherProblem(await seeded(), KIT_HOME), undefined);
  });

  it('refuses a kit home with no current version', async () => {
    assert.match((await hookLauncherProblem(new MemoryFiles(), KIT_HOME)) ?? '', /^no teamrig version is current in the kit home .*: start one teamrig session/u);
  });

  it('refuses a kit home whose two records disagree', async () => {
    const files = await seeded();
    await files.write(kitCurrentPath(KIT_HOME), '0.511.0\n');
    assert.match((await hookLauncherProblem(files, KIT_HOME)) ?? '', /^no teamrig version is current/u);
  });

  it('refuses a current version whose files differ from its integrity list', async () => {
    const files = await seeded();
    await files.write(join(kitVersionFolder(KIT_HOME, VERSION), KIT_LAUNCHER_FILE), '// edited\n');
    assert.match((await hookLauncherProblem(files, KIT_HOME)) ?? '', /^teamrig 0\.510\.0 in the kit home differs from its integrity list: start one/u);
  });

  it('refuses a kit home with no launcher on PATH', async () => {
    const files = await seeded();
    files.removeAll(cliLauncherPath(KIT_HOME));
    assert.match((await hookLauncherProblem(files, KIT_HOME)) ?? '', /^the kit launcher .*teamrig\.mjs is missing: start one/u);
  });

  it('refuses a launcher on PATH that is not the one the current version ships', async () => {
    const files = await seeded();
    await files.write(cliLauncherPath(KIT_HOME), '// an older launcher\n');
    assert.match((await hookLauncherProblem(files, KIT_HOME)) ?? '', /^the kit launcher .*teamrig\.mjs is not the one teamrig 0\.510\.0 ships: start one/u);
  });
});

describe('syncKitLauncher', () => {
  it('writes the launcher the current version ships when the one on PATH is missing, so a hook line can run', async () => {
    const files = await seeded();
    files.removeAll(cliLauncherPath(KIT_HOME));
    assert.deepEqual(await syncKitLauncher(files, KIT_HOME), { kind: 'written', path: cliLauncherPath(KIT_HOME), version: VERSION });
    assert.equal(files.get(cliLauncherPath(KIT_HOME)), SEEDED_LAUNCHER_TEXT);
    assert.equal(await hookLauncherProblem(files, KIT_HOME), undefined);
  });

  it('replaces a launcher on PATH that another version shipped', async () => {
    const files = await seeded();
    await files.write(cliLauncherPath(KIT_HOME), '// an older launcher\n');
    assert.equal((await syncKitLauncher(files, KIT_HOME)).kind, 'written');
    assert.equal(files.get(cliLauncherPath(KIT_HOME)), SEEDED_LAUNCHER_TEXT);
  });

  it('leaves a launcher that is already the current one as it is', async () => {
    assert.equal((await syncKitLauncher(await seeded(), KIT_HOME)).kind, 'unchanged');
  });

  it('writes nothing for a kit home with no current version', async () => {
    const files = new MemoryFiles();
    assert.deepEqual(await syncKitLauncher(files, KIT_HOME), { kind: 'missing', why: `no teamrig version is current in the kit home ${KIT_HOME}` });
    assert.equal(files.get(cliLauncherPath(KIT_HOME)), undefined);
  });

  it('writes nothing when the current version ships no launcher', async () => {
    const files = await seeded();
    files.removeAll(join(kitVersionFolder(KIT_HOME, VERSION), KIT_LAUNCHER_FILE));
    files.removeAll(cliLauncherPath(KIT_HOME));
    assert.equal((await syncKitLauncher(files, KIT_HOME)).kind, 'missing');
    assert.equal(files.get(cliLauncherPath(KIT_HOME)), undefined);
  });
});
