import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PaneOpen } from '../../../plugin-api/index.ts';
import { terminalDeps } from '../../../testing/adapter-deps.ts';
import { FakeProcesses } from '../../../testing/fake-processes.ts';
import { tmuxPort } from './port.ts';

const PANE: PaneOpen = { title: 'worker [p1]', folder: '/work/repo', argv: ['claude', '--resume'], window: undefined, focus: 'take', identity: {}, wakeToken: 'token' };

describe('the tmux port', () => {
  it('opens a pane as a new window named by its title, in its folder, the command as separate arguments', async () => {
    const processes = new FakeProcesses().onStart('tmux', { kind: 'started', end: 'exited' });
    assert.deepEqual(await tmuxPort(terminalDeps({ processes })).open(PANE), { kind: 'opened', pane: 'worker [p1]' });
    assert.deepEqual(processes.started, [
      { command: 'tmux', args: ['new-window', '-c', '/work/repo', '-n', 'worker [p1]', 'claude', '--resume'], cwd: '/work/repo', mode: 'exit' },
    ]);
  });

  it('leaves the current window selected when the focus is kept', async () => {
    const processes = new FakeProcesses().onStart('tmux', { kind: 'started', end: 'exited' });
    await tmuxPort(terminalDeps({ processes })).open({ ...PANE, focus: 'keep' });
    assert.deepEqual(processes.started[0]?.args.slice(0, 2), ['new-window', '-d']);
  });

  it('answers failed, with why, when tmux is missing or its launcher fails', async () => {
    assert.deepEqual(await tmuxPort(terminalDeps()).open(PANE), { kind: 'failed', why: 'tmux is not installed' });
    const failing = new FakeProcesses().onStart('tmux', { kind: 'failed', error: 'exited with code 1: no server running' });
    assert.deepEqual(await tmuxPort(terminalDeps({ processes: failing })).open(PANE), { kind: 'failed', why: 'exited with code 1: no server running' });
  });

  it("focuses the window named exactly as the pane, run in teamrig's folder with its environment", async () => {
    const processes = new FakeProcesses();
    const env = { TMUX: '/tmp/tmux-1/default,1,0' };
    assert.deepEqual(await tmuxPort(terminalDeps({ processes, env, cwd: '/srv/team' })).focus('worker [p1]'), { kind: 'done' });
    assert.deepEqual(processes.ran, [{ command: 'tmux', args: ['select-window', '-t', '=worker [p1]'], cwd: '/srv/team', env }]);
  });

  it('answers gone when tmux has no such window, and failed when tmux cannot run', async () => {
    const noWindow = new FakeProcesses().onRun('tmux', { kind: 'exited', code: 1 });
    assert.deepEqual(await tmuxPort(terminalDeps({ processes: noWindow })).focus('worker'), { kind: 'gone' });
    const missing = new FakeProcesses().onRun('tmux', { kind: 'missing' });
    assert.deepEqual(await tmuxPort(terminalDeps({ processes: missing })).focus('worker'), { kind: 'failed', why: 'tmux is not installed' });
    const failing = new FakeProcesses().onRun('tmux', { kind: 'failed', error: 'spawn EACCES' });
    assert.deepEqual(await tmuxPort(terminalDeps({ processes: failing })).focus('worker'), { kind: 'failed', why: 'spawn EACCES' });
  });
});
