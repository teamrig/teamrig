import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bareHost } from '../testing/bare-host.ts';
import { FakeSessionProcesses } from '../testing/fake-session-processes.ts';
import { hostRunning } from '../testing/host.ts';
import { quietWorld } from '../testing/quiet-world.ts';
import { hostSessionAbove, runsHostSession, type SessionProcessRuntime } from './session-process.ts';

const SHIPPED = 41;
const OTHER = 42;
const EDITOR = 43;
const GONE = 44;

function processes(): FakeSessionProcesses {
  return new FakeSessionProcesses()
    .add({ pid: SHIPPED, parentPid: 1, name: 'claude.exe', commandLine: '' })
    .add({ pid: OTHER, parentPid: 1, name: 'agent-desk', commandLine: 'agent-desk --resume' })
    .add({ pid: EDITOR, parentPid: 1, name: 'notepad.exe', commandLine: '' });
}

function runtimeOf(pick: Pick<SessionProcessRuntime, 'host' | 'shippedHosts'>): SessionProcessRuntime {
  return { ...pick, env: {}, platform: 'linux', sessionProcesses: processes() };
}

async function running(runtime: SessionProcessRuntime): Promise<boolean[]> {
  return Promise.all([SHIPPED, OTHER, EDITOR, GONE, undefined].map((pid) => runsHostSession(runtime, pid)));
}

describe('hostSessionAbove', () => {
  /** A hook (this run) started by the shell 11 under the program `name` as process 10. */
  function under(name: string, pick: Pick<SessionProcessRuntime, 'host' | 'shippedHosts'>): SessionProcessRuntime {
    const sessionProcesses = new FakeSessionProcesses(11).add({ pid: 10, parentPid: 1, name, commandLine: name }).add({ pid: 11, parentPid: 10, name: 'bash', commandLine: 'bash -c hook' });
    return { ...pick, env: {}, platform: 'linux', sessionProcesses };
  }

  it("finds the shipped host's session this run was started under, past the shell between, whatever host the run works in", async () => {
    const { host, shippedHosts } = quietWorld();
    assert.equal(await hostSessionAbove(under('claude', { host, shippedHosts })), 10);
    assert.equal(await hostSessionAbove(under('claude', { host: hostRunning('agent-desk'), shippedHosts })), 10);
  });

  it("finds the running host's session by the program that host names, which no other host takes for one", async () => {
    const { host, shippedHosts } = quietWorld();
    assert.equal(await hostSessionAbove(under('agent-desk', { host: hostRunning('agent-desk'), shippedHosts })), 10);
    assert.equal(await hostSessionAbove(under('agent-desk', { host, shippedHosts })), undefined);
  });
});

describe('runsHostSession', () => {
  it("tells a pid running a shipped host's session from another program's, a gone one and none", async () => {
    const { host, shippedHosts } = quietWorld();
    assert.deepEqual(await running(runtimeOf({ host, shippedHosts })), [true, false, false, false, false]);
  });

  it('counts the program of the host the run works in beside the shipped ones', async () => {
    const { shippedHosts } = quietWorld();
    assert.deepEqual(await running(runtimeOf({ host: hostRunning('agent-desk'), shippedHosts })), [true, true, false, false, false]);
  });

  it('counts a shipped host\'s session on a host that tells nothing of its own, and none where no host tells of any', async () => {
    const { shippedHosts } = quietWorld();
    const bare = (): ReturnType<typeof bareHost> => bareHost();
    assert.deepEqual(await running(runtimeOf({ host: bare, shippedHosts })), [true, false, false, false, false]);
    assert.deepEqual(await running(runtimeOf({ host: bare, shippedHosts: [] })), [false, false, false, false, false]);
  });
});
