import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { InlineMutex } from '../testing/inline-mutex.ts';
import { writeKitRelease } from '../testing/kit-release.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { MemoryKitTree } from '../testing/memory-kit-tree.ts';
import { installRunningKit, kitSelfInstallLogLine, kitSelfInstallNote } from './kit-self-install.ts';
import { kitCurrentPath, kitVersionFolder, useKitVersion } from './kit-versions.ts';

const KIT = '/home/user/.teamrig';
const PLUGIN = '/home/user/.claude/plugins/cache/teamrig/teamrig';

describe('installRunningKit', () => {
  let files: MemoryFiles;
  let tree: MemoryKitTree;
  const selfInstall = (clientRoot: string, version: string) => installRunningKit({ files, tree, kitHome: KIT, clientRoot, version, lock: new InlineMutex() });

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

  it('logs a refused copy and leaves current alone', async () => {
    await selfInstall(join(PLUGIN, '0.508.0'), '0.508.0');
    await files.write(join(PLUGIN, '0.509.0', 'package.json'), '{"type":"commonjs"}\n');
    const outcome = await selfInstall(join(PLUGIN, '0.509.0'), '0.509.0');
    assert.equal(outcome.kind, 'refused');
    assert.match(kitSelfInstallLogLine(outcome) ?? '', /^kit: refused: the copy of 0\.509\.0 is not whole/);
    assert.equal(files.get(kitCurrentPath(KIT)), '0.508.0\n');
  });
});
