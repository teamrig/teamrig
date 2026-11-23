import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PaneOpen } from '../../../plugin-api/index.ts';
import { terminalDeps } from '../../../testing/adapter-deps.ts';
import { FakeProcesses } from '../../../testing/fake-processes.ts';
import { konsolePort } from './port.ts';

const PANE: PaneOpen = { title: 'worker [p1]', folder: '/work/my repo', argv: ['claude', '--resume'], window: undefined, focus: 'take', identity: {}, wakeToken: 'token' };

describe('the Konsole port', () => {
  it('opens a tab in its folder, the command as separate arguments, the launcher being the window itself', async () => {
    const processes = new FakeProcesses().onStart('konsole', { kind: 'started', end: 'spawned' });
    assert.deepEqual(await konsolePort(terminalDeps({ processes })).open(PANE), { kind: 'opened', pane: 'worker [p1]' });
    assert.deepEqual(processes.started, [
      { command: 'konsole', args: ['--new-tab', '--workdir', '/work/my repo', '-e', 'claude', '--resume'], cwd: '/work/my repo', mode: 'spawn' },
    ]);
  });

  it('answers failed, with why, when konsole is missing or cannot start', async () => {
    assert.deepEqual(await konsolePort(terminalDeps()).open(PANE), { kind: 'failed', why: 'konsole is not installed' });
    const failing = new FakeProcesses().onStart('konsole', { kind: 'failed', error: 'spawn EACCES' });
    assert.deepEqual(await konsolePort(terminalDeps({ processes: failing })).open(PANE), { kind: 'failed', why: 'spawn EACCES' });
  });

  it('serves open alone, answering unserved to every other request', async () => {
    const port = konsolePort(terminalDeps());
    assert.deepEqual((await port.capabilities()).requests, ['open']);
    assert.deepEqual(await port.focus('worker'), { kind: 'unserved' });
  });
});
