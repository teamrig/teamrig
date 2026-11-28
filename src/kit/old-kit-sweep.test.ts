import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FakeSessionProcesses } from '../testing/fake-session-processes.ts';
import { seedKitHome } from '../testing/kit-home.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { claimOldKitSweep, endOldKitTargets, oldKitEndLine, oldKitSweepStampPath, OLD_KIT_SWEEP_EVERY_MS, planOldKitSweep, type OldKitSweepPorts } from './old-kit-sweep.ts';

const KIT_HOME = '/opt/team/.teamrig';
const ROOT = `${KIT_HOME}/versions`;
const OWN_PID = 900;

function entry(version: string): string {
  return `node ${ROOT}/${version}/dist/cli/main.js`;
}

/** An old watcher 100, an old UI 200 with its UI child 201, a current watcher 300 and this sweep 900. */
function host(): FakeSessionProcesses {
  return new FakeSessionProcesses()
    .add({ pid: 100, parentPid: 1, name: 'node', commandLine: `${entry('0.505.0')} events --json` })
    .add({ pid: 200, parentPid: 1, name: 'node', commandLine: `${entry('0.504.0')} ui` })
    .add({ pid: 201, parentPid: 200, name: 'node', commandLine: `node ${KIT_HOME}/ui/0.80.0/ui/main.js` })
    .add({ pid: 300, parentPid: 1, name: 'node', commandLine: `${entry('0.510.0')} events --json` })
    .add({ pid: OWN_PID, parentPid: 1, name: 'node', commandLine: `${entry('0.510.0')} kit sweep --yes` });
}

async function portsOver(processes: FakeSessionProcesses, platform: NodeJS.Platform = 'linux', running = '0.510.0'): Promise<OldKitSweepPorts> {
  const files = new MemoryFiles();
  await seedKitHome(files, KIT_HOME, '0.510.0');
  return { files, kitHome: KIT_HOME, running, roots: [ROOT], platform, ownPid: OWN_PID, processes };
}

describe('planOldKitSweep', () => {
  it("finds each older version's watcher and ui with its tree, and leaves the current version's alone", async () => {
    const plan = await planOldKitSweep(await portsOver(host()));
    assert.deepEqual(plan, {
      kind: 'found',
      targets: [
        { pid: 100, version: '0.505.0', word: 'events', tree: [100] },
        { pid: 200, version: '0.504.0', word: 'ui', tree: [200, 201] },
      ],
    });
  });

  it('ends nothing when this teamrig is not the version current names', async () => {
    const processes = host();
    assert.deepEqual(await planOldKitSweep(await portsOver(processes, 'linux', '0.505.0')), { kind: 'not-current', current: '0.510.0' });
  });

  it('ends nothing when no version is current', async () => {
    const ports = { ...(await portsOver(host())), files: new MemoryFiles() };
    assert.deepEqual(await planOldKitSweep(ports), { kind: 'not-current', current: undefined });
  });

  it('says so when the system will not list its processes', async () => {
    assert.deepEqual(await planOldKitSweep(await portsOver(host().hideListing())), { kind: 'unlisted' });
  });

  it('leaves out an old tree this sweep runs in', async () => {
    const processes = new FakeSessionProcesses()
      .add({ pid: 100, parentPid: 1, name: 'node', commandLine: `${entry('0.505.0')} ui` })
      .add({ pid: OWN_PID, parentPid: 100, name: 'node', commandLine: `${entry('0.510.0')} kit sweep --yes` });
    assert.deepEqual(await planOldKitSweep(await portsOver(processes)), { kind: 'found', targets: [] });
  });

  it('keeps a Windows listing’s start times, so a later process holding an ended starter’s id is no child', async () => {
    const processes = new FakeSessionProcesses()
      .add({ pid: 200, parentPid: 1, name: 'node.exe', commandLine: `${entry('0.504.0')} ui` }, 2_000)
      .add({ pid: 201, parentPid: 200, name: 'node.exe', commandLine: 'node ui/main.js' }, 1_000);
    assert.deepEqual(await planOldKitSweep(await portsOver(processes, 'win32')), {
      kind: 'found',
      targets: [{ pid: 200, version: '0.504.0', word: 'ui', tree: [200] }],
    });
  });
});

describe('endOldKitTargets', () => {
  it('ends each pid of a tree in turn on POSIX, the target first', async () => {
    const processes = host();
    const ports = await portsOver(processes);
    const plan = await planOldKitSweep(ports);
    assert.equal(plan.kind, 'found');
    const ends = plan.kind === 'found' ? await endOldKitTargets(ports, plan.targets) : [];
    assert.deepEqual(processes.ends, [
      { pid: 100, how: 'force' },
      { pid: 200, how: 'force' },
      // The fake ends a tree whole, so the child is gone by then, which counts as ended.
      { pid: 201, how: 'force' },
    ]);
    assert.deepEqual(
      ends.map((end) => end.failed),
      [undefined, undefined],
    );
    assert.equal(processes.alive(300), true);
    assert.equal(processes.alive(OWN_PID), true);
  });

  it('ends only the target on Windows, whose end sweeps its tree', async () => {
    const processes = host();
    const ports = await portsOver(processes, 'win32');
    await endOldKitTargets(ports, [{ pid: 200, version: '0.504.0', word: 'ui', tree: [200, 201] }]);
    assert.deepEqual(processes.ends, [{ pid: 200, how: 'force' }]);
    assert.equal(processes.alive(201), false);
  });

  it('names the first pid that would not end, and goes on to the next target', async () => {
    const processes = host().failEnd(200, 'access denied');
    const ends = await endOldKitTargets(await portsOver(processes), [
      { pid: 200, version: '0.504.0', word: 'ui', tree: [200, 201] },
      { pid: 100, version: '0.505.0', word: 'events', tree: [100] },
    ]);
    assert.deepEqual(
      ends.map(oldKitEndLine),
      ['kit: could not end old ui 200 (0.504.0), tree 200 201: 200: access denied', 'kit: ended old events 100 (0.505.0), tree 100'],
    );
  });
});

describe('claimOldKitSweep', () => {
  const now = 1_800_000_000_000;

  it('claims with no stamp, and writes one', async () => {
    const files = new MemoryFiles();
    assert.equal(await claimOldKitSweep(files, KIT_HOME, now), true);
    assert.equal(await files.read(oldKitSweepStampPath(KIT_HOME)), `${now}\n`);
  });

  it('refuses within the interval, and claims once it has passed', async () => {
    const files = new MemoryFiles({ [oldKitSweepStampPath(KIT_HOME)]: `${now}\n` });
    assert.equal(await claimOldKitSweep(files, KIT_HOME, now + OLD_KIT_SWEEP_EVERY_MS - 1), false);
    assert.equal(await claimOldKitSweep(files, KIT_HOME, now + OLD_KIT_SWEEP_EVERY_MS), true);
  });

  it('claims over a stamp it cannot read or one in the future', async () => {
    const unreadable = new MemoryFiles({ [oldKitSweepStampPath(KIT_HOME)]: 'soon\n' });
    assert.equal(await claimOldKitSweep(unreadable, KIT_HOME, now), true);
    const ahead = new MemoryFiles({ [oldKitSweepStampPath(KIT_HOME)]: `${now + 1}\n` });
    assert.equal(await claimOldKitSweep(ahead, KIT_HOME, now), true);
  });
});
