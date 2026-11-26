import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BusyMutex } from '../testing/busy-mutex.ts';
import { InlineMutex } from '../testing/inline-mutex.ts';
import { writeKitRelease } from '../testing/kit-release.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { MemoryKitTree } from '../testing/memory-kit-tree.ts';
import { installRunningKit, kitSelfInstallLogLine, kitSelfInstallNote } from './kit-self-install.ts';
import { kitCurrentPath, kitVersionFolder, readKitCurrent, useKitVersion, type KitSource } from './kit-versions.ts';

const KIT = '/home/user/.teamrig';
const PLUGIN = '/home/user/.claude/plugins/cache/teamrig/teamrig';
const FROM_PLUGIN: KitSource = { kind: 'claude-code-plugin' };

describe('installRunningKit', () => {
  let files: MemoryFiles;
  let tree: MemoryKitTree;
  const selfInstall = (clientRoot: string, version: string) => installRunningKit({ files, tree, kitHome: KIT, clientRoot, version, source: FROM_PLUGIN, lock: new InlineMutex() });

  beforeEach(async () => {
    files = new MemoryFiles();
    tree = new MemoryKitTree(files);
    await writeKitRelease(files, join(PLUGIN, '0.508.0'), '0.508.0');
    await writeKitRelease(files, join(PLUGIN, '0.509.0'), '0.509.0');
  });

  it('copies the running plugin into the kit home and names it current', async () => {
    const outcome = await selfInstall(join(PLUGIN, '0.508.0'), '0.508.0');
    assert.deepEqual(outcome, { kind: 'installed', version: '0.508.0' });
    assert.equal(files.get(kitCurrentPath(KIT)), '0.508.0\n');
    assert.equal(kitSelfInstallLogLine(outcome), 'kit: none -> 0.508.0: current');
    assert.equal(kitSelfInstallNote(outcome), undefined);
  });

  it('records where the client came from, so a release clone is told from a plugin', async () => {
    const source: KitSource = { kind: 'github-release', tag: 'v0.508.0', commit: 'a'.repeat(40) };
    await installRunningKit({ files, tree, kitHome: KIT, clientRoot: join(PLUGIN, '0.508.0'), version: '0.508.0', source, lock: new InlineMutex() });
    assert.deepEqual((await readKitCurrent(files, KIT))?.source, source);
  });

  it('copies nothing for a client running from the kit versions folder', async () => {
    await selfInstall(join(PLUGIN, '0.508.0'), '0.508.0');
    assert.deepEqual(await selfInstall(kitVersionFolder(KIT, '0.508.0'), '0.508.0'), { kind: 'skipped', why: 'runs-from-kit' });
    assert.equal(tree.copies.length, 1);
  });

  it('copies nothing for a source tree with no integrity list', async () => {
    const outcome = await selfInstall('/work/teamrig/plugins/teamrig', '0.509.0');
    assert.deepEqual(outcome, { kind: 'skipped', why: 'no-integrity-list' });
    assert.equal(tree.copies.length, 0);
    assert.equal(files.get(kitCurrentPath(KIT)), undefined);
    assert.equal(kitSelfInstallLogLine(outcome), undefined);
  });

  it('names the pin and the newer version at each start of a pinned install', async () => {
    await selfInstall(join(PLUGIN, '0.508.0'), '0.508.0');
    await useKitVersion({ files, kitHome: KIT, lock: new InlineMutex() }, { kind: 'version', version: '0.508.0' });
    const outcome = await selfInstall(join(PLUGIN, '0.509.0'), '0.509.0');
    assert.equal(kitSelfInstallNote(outcome), 'teamrig pinned at 0.508.0; 0.509.0 is installed; `teamrig kit use --latest` moves to it.');
    assert.equal(kitSelfInstallLogLine(outcome), 'kit: 0.509.0 kept; current pinned at 0.508.0');
    assert.equal(files.get(kitCurrentPath(KIT)), '0.508.0\n');
  });

  it('names the newer current and the way to the older version at each start of an older plugin', async () => {
    await selfInstall(join(PLUGIN, '0.508.0'), '0.508.0');
    await selfInstall(join(PLUGIN, '0.509.0'), '0.509.0');
    const outcome = await selfInstall(join(PLUGIN, '0.508.0'), '0.508.0');
    assert.deepEqual(outcome, { kind: 'older', version: '0.508.0', current: '0.509.0' });
    assert.equal(kitSelfInstallNote(outcome), "teamrig 0.509.0 stays current; this plugin's 0.508.0 is older and kept; `teamrig kit use 0.508.0` moves to it.");
    assert.equal(kitSelfInstallLogLine(outcome), 'kit: 0.508.0 kept; current 0.509.0 is newer');
    assert.equal(files.get(kitCurrentPath(KIT)), '0.509.0\n');
  });

  it('gives no note and no log line for a start that finds another start copying', async () => {
    const outcome = await installRunningKit({ files, tree, kitHome: KIT, clientRoot: join(PLUGIN, '0.508.0'), version: '0.508.0', source: FROM_PLUGIN, lock: new BusyMutex() });
    assert.deepEqual([outcome, kitSelfInstallNote(outcome), kitSelfInstallLogLine(outcome)], [{ kind: 'busy' }, undefined, undefined]);
    assert.deepEqual([tree.copies.length, files.get(kitCurrentPath(KIT))], [0, undefined]);
  });

  it('logs a refused copy and leaves current alone', async () => {
    await selfInstall(join(PLUGIN, '0.508.0'), '0.508.0');
    await files.write(join(PLUGIN, '0.509.0', 'package.json'), '{"type":"commonjs"}\n');
    const outcome = await selfInstall(join(PLUGIN, '0.509.0'), '0.509.0');
    assert.equal(outcome.kind, 'refused');
    assert.match(kitSelfInstallLogLine(outcome) ?? '', /^kit: refused: the copy of 0\.509\.0 is not whole/);
    assert.equal(files.get(kitCurrentPath(KIT)), '0.508.0\n');
  });
});
