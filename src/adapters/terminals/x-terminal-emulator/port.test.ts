import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PaneOpen } from '../../../plugin-api/index.ts';
import { terminalDeps } from '../../../testing/adapter-deps.ts';
import { FakeProcesses } from '../../../testing/fake-processes.ts';
import { xTerminalEmulatorPort } from './port.ts';

const PANE: PaneOpen = { title: 'worker [p1]', folder: '/work/my repo', argv: ['claude', '--resume'], window: undefined, focus: 'take', identity: {}, wakeToken: 'token' };

describe('the x-terminal-emulator port', () => {
  it('opens a window titled by the pane, started in its folder, the command as separate arguments', async () => {
    const processes = new FakeProcesses().onStart('x-terminal-emulator', { kind: 'started', end: 'spawned' });
    assert.deepEqual(await xTerminalEmulatorPort(terminalDeps({ processes })).open(PANE), { kind: 'opened', pane: 'worker [p1]' });
    assert.deepEqual(processes.started, [
      { command: 'x-terminal-emulator', args: ['-T', 'worker [p1]', '-e', 'claude', '--resume'], cwd: '/work/my repo', mode: 'spawn' },
    ]);
  });

  it('answers failed, with why, when x-terminal-emulator is missing or cannot start', async () => {
    assert.deepEqual(await xTerminalEmulatorPort(terminalDeps()).open(PANE), { kind: 'failed', why: 'x-terminal-emulator is not installed' });
    const failing = new FakeProcesses().onStart('x-terminal-emulator', { kind: 'failed', error: 'spawn EACCES' });
    assert.deepEqual(await xTerminalEmulatorPort(terminalDeps({ processes: failing })).open(PANE), { kind: 'failed', why: 'spawn EACCES' });
  });

  it('serves open alone, answering unserved to every other request', async () => {
    const port = xTerminalEmulatorPort(terminalDeps());
    assert.deepEqual((await port.capabilities()).requests, ['open']);
    assert.deepEqual(await port.focus('worker [p1]'), { kind: 'unserved' });
  });
});
