import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PaneOpen } from '../../../plugin-api/index.ts';
import { terminalDeps } from '../../../testing/adapter-deps.ts';
import { FakeProcesses } from '../../../testing/fake-processes.ts';
import { gnomeTerminalPort } from './port.ts';

const PANE: PaneOpen = { title: 'worker [p1]', folder: '/work/my repo', argv: ['claude', '--resume'], window: undefined, focus: 'take', identity: {}, wakeToken: 'token' };

describe('the GNOME Terminal port', () => {
  it('opens a tab in its folder, the command as separate arguments, and waits for the launcher to exit', async () => {
    const processes = new FakeProcesses().onStart('gnome-terminal', { kind: 'started', end: 'exited' });
    assert.deepEqual(await gnomeTerminalPort(terminalDeps({ processes })).open(PANE), { kind: 'opened', pane: 'worker [p1]' });
    assert.deepEqual(processes.started, [
      { command: 'gnome-terminal', args: ['--tab', '--working-directory=/work/my repo', '--', 'claude', '--resume'], cwd: '/work/my repo', mode: 'exit' },
    ]);
  });

  it('answers failed, with why, when gnome-terminal is missing or fails', async () => {
    assert.deepEqual(await gnomeTerminalPort(terminalDeps()).open(PANE), { kind: 'failed', why: 'gnome-terminal is not installed' });
    const failing = new FakeProcesses().onStart('gnome-terminal', { kind: 'failed', error: 'exited with code 1: no display' });
    assert.deepEqual(await gnomeTerminalPort(terminalDeps({ processes: failing })).open(PANE), { kind: 'failed', why: 'exited with code 1: no display' });
  });

  it('serves open alone, answering unserved to every other request', async () => {
    const port = gnomeTerminalPort(terminalDeps());
    assert.deepEqual((await port.capabilities()).requests, ['open']);
    assert.deepEqual(await port.focus('worker'), { kind: 'unserved' });
  });
});
