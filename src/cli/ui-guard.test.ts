import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Sleep } from '../core/lock.ts';
import { FakeSessionProcesses } from '../testing/fake-session-processes.ts';
import { seedKitHome } from '../testing/kit-home.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { newerCurrent, startUiGuard, uiEndText, UI_GUARD_EVERY_MS, type UiGuard, type UiGuardPorts } from './ui-guard.ts';

const KIT_HOME = '/opt/team/.teamrig';
const OWN_PID = 900;

/** A wait a spec ends by hand, one look of the guard at a time. */
class HandSleep {
  readonly waits: number[] = [];
  private readonly waiting: (() => void)[] = [];

  readonly sleep: Sleep = (ms) =>
    new Promise((resolve) => {
      this.waits.push(ms);
      this.waiting.push(resolve);
    });

  /** Ends the wait the guard is in, and lets its look run to its next wait. */
  async wake(): Promise<void> {
    this.waiting.shift()?.();
    for (let turn = 0; turn < 5; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

/** A terminal 50, this `teamrig ui` 900 under it, its UI 901 and the UI's own child 902. */
function host(): FakeSessionProcesses {
  return new FakeSessionProcesses()
    .add({ pid: 50, parentPid: 1, name: 'WindowsTerminal.exe', commandLine: '' })
    .add({ pid: OWN_PID, parentPid: 50, name: 'node', commandLine: 'node teamrig ui' })
    .add({ pid: 901, parentPid: OWN_PID, name: 'node', commandLine: 'node ui/main.js' })
    .add({ pid: 902, parentPid: 901, name: 'node', commandLine: 'node ui/worker.js' });
}

async function guarded(
  processes: FakeSessionProcesses,
  { current = '0.510.0', running = '0.510.0', platform = 'linux' }: { current?: string; running?: string; platform?: NodeJS.Platform } = {},
): Promise<{ readonly guard: UiGuard; readonly hand: HandSleep; readonly ports: UiGuardPorts }> {
  const files = new MemoryFiles();
  await seedKitHome(files, KIT_HOME, current);
  const hand = new HandSleep();
  const ports: UiGuardPorts = { files, kitHome: KIT_HOME, running, ownPid: OWN_PID, platform, processes, sleep: hand.sleep };
  return { guard: startUiGuard(ports), hand, ports };
}

describe('newerCurrent', () => {
  it('names the version current names only when it is newer than the running one', async () => {
    const files = new MemoryFiles();
    assert.equal(await newerCurrent(files, KIT_HOME, '0.510.0'), undefined);
    await seedKitHome(files, KIT_HOME, '0.511.0');
    assert.equal(await newerCurrent(files, KIT_HOME, '0.510.0'), '0.511.0');
    assert.equal(await newerCurrent(files, KIT_HOME, '0.511.0'), undefined);
    assert.equal(await newerCurrent(files, KIT_HOME, '0.512.0'), undefined);
    assert.equal(await newerCurrent(files, KIT_HOME, 'dev'), undefined);
  });
});

describe('startUiGuard', () => {
  it('waits a look first, then ends the UI and its child once a newer version is current', async () => {
    const processes = host();
    const { guard, hand } = await guarded(processes, { current: '0.511.0' });
    assert.deepEqual(processes.ends, []);
    await hand.wake();
    assert.deepEqual(guard.reason(), { kind: 'superseded', current: '0.511.0' });
    assert.deepEqual(processes.ends, [
      { pid: 901, how: 'force' },
      { pid: 902, how: 'force' },
    ]);
    assert.ok(processes.alive(OWN_PID) && processes.alive(50), 'the guard ends only what this process started');
    assert.deepEqual(hand.waits, [UI_GUARD_EVERY_MS]);
  });

  it('ends only the direct children on Windows, where an end takes the whole tree', async () => {
    const processes = host();
    const { hand } = await guarded(processes, { current: '0.511.0', platform: 'win32' });
    await hand.wake();
    assert.deepEqual(processes.ends, [{ pid: 901, how: 'force' }]);
    assert.equal(processes.alive(902), false);
  });

  it('leaves the UI running while this version, or an older one, is current and its terminal runs', async () => {
    const processes = host();
    const { guard, hand } = await guarded(processes, { current: '0.509.0' });
    for (let look = 0; look < 3; look += 1) {
      await hand.wake();
    }
    assert.equal(guard.reason(), undefined);
    assert.deepEqual(processes.ends, []);
    assert.equal(hand.waits.length, 4);
  });

  it('ends the UI once a process it ran under at its first look has ended', async () => {
    const processes = host();
    const { guard, hand } = await guarded(processes);
    await hand.wake();
    assert.deepEqual(processes.lineages, [OWN_PID]);
    processes.exit(50);
    await hand.wake();
    const reason = guard.reason();
    assert.equal(reason?.kind, 'terminal-gone');
    assert.equal(reason === undefined ? '' : uiEndText(reason), 'ENDED the UI: WindowsTerminal.exe 50, which it ran under, has ended');
    assert.deepEqual(processes.ends.map((end) => end.pid), [901, 902]);
  });

  it('never takes a launcher that ended before its first look for the terminal', async () => {
    const processes = host().add({ pid: 40, parentPid: 50, name: 'wt.exe', commandLine: 'wt.exe' });
    processes.add({ pid: OWN_PID, parentPid: 40, name: 'node', commandLine: 'node teamrig ui' });
    const { guard, hand } = await guarded(processes);
    processes.exit(40);
    await hand.wake();
    await hand.wake();
    assert.equal(guard.reason(), undefined);
    assert.deepEqual(processes.ends, []);
  });

  it('keeps the reason and looks again when the processes cannot be listed, keeping the problem', async () => {
    const processes = host().hideListing();
    const { guard, hand } = await guarded(processes, { current: '0.511.0' });
    await hand.wake();
    assert.equal(guard.reason()?.kind, 'superseded');
    assert.match(guard.problem() ?? '', /^WARN the UI guard could not list the processes/);
    assert.deepEqual(processes.ends, []);
    assert.equal(hand.waits.length, 2);
  });

  it('keeps the problem of an end that failed and ends again at the next look', async () => {
    const processes = host().failEnd(901, 'denied');
    const { guard, hand } = await guarded(processes, { current: '0.511.0' });
    await hand.wake();
    assert.equal(guard.problem(), 'WARN the UI guard could not end 901: denied; the next look tries again');
    await hand.wake();
    assert.deepEqual(processes.ends.map((end) => end.pid), [901, 902, 901]);
  });

  it('looks no more once stopped', async () => {
    const processes = host();
    const { guard, hand } = await guarded(processes, { current: '0.511.0' });
    guard.stop();
    await hand.wake();
    assert.equal(guard.reason(), undefined);
    assert.deepEqual(processes.ends, []);
    assert.equal(hand.waits.length, 1);
  });

  it('says which version is installed when it ends a superseded UI', () => {
    assert.match(uiEndText({ kind: 'superseded', current: '0.511.0' }), /^ENDED the UI: teamrig 0\.511\.0 is installed, and this UI ran \d+\.\d+\.\d+; run teamrig ui again$/);
  });
});
