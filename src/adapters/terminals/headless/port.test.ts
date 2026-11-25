import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PaneOpen } from '../../../plugin-api/index.ts';
import { terminalDeps } from '../../../testing/adapter-deps.ts';
import { FakeProcesses } from '../../../testing/fake-processes.ts';
import { conhostOf, headlessPort, tmuxSessionOf } from './port.ts';

const PANE: PaneOpen = { title: 'worker [p1]', folder: '/work/my repo', argv: ['claude', '--resume'], window: undefined, focus: 'take', identity: {}, wakeToken: 'token' };
const WINDOWS_PANE: PaneOpen = { ...PANE, folder: 'C:\\work\\my repo' };
const WINDOWS_ENV = { SystemRoot: 'C:\\Win\\', ComSpec: 'C:\\Win\\system32\\cmd.exe' };

describe('the headless port', () => {
  it('on Windows starts the command under conhost --headless through cmd start, detached, in the pane folder', async () => {
    const processes = new FakeProcesses().onStart('C:\\Win\\system32\\cmd.exe', { kind: 'started', end: 'spawned' });
    const port = headlessPort(terminalDeps({ platform: 'win32', env: WINDOWS_ENV, processes }));
    assert.deepEqual(await port.open(WINDOWS_PANE), { kind: 'opened', pane: 'worker [p1]' });
    assert.deepEqual(processes.started, [
      {
        command: 'C:\\Win\\system32\\cmd.exe',
        args: ['/d', '/c', 'start', '', 'C:\\Win\\System32\\conhost.exe', '--headless', 'claude', '--resume'],
        cwd: 'C:\\work\\my repo',
        mode: 'spawn',
      },
    ]);
  });

  it('on Windows falls back to cmd.exe and C:\\Windows when the environment names neither', async () => {
    const processes = new FakeProcesses().onStart('cmd.exe', { kind: 'started', end: 'spawned' });
    await headlessPort(terminalDeps({ platform: 'win32', processes })).open(WINDOWS_PANE);
    assert.equal(processes.started[0]?.command, 'cmd.exe');
    assert.equal(processes.started[0]?.args[4], 'C:\\Windows\\System32\\conhost.exe');
    assert.equal(conhostOf({ SystemRoot: '  ' }), 'C:\\Windows\\System32\\conhost.exe');
  });

  it('on Windows refuses, starting nothing, an argument or folder cmd would misread', async () => {
    for (const unsafe of ['a&b', 'a|b', 'a<b', 'a>b', 'a^b', '%PATH%', 'a"b', 'a\nb']) {
      const processes = new FakeProcesses().onStart('cmd.exe', { kind: 'started', end: 'spawned' });
      const port = headlessPort(terminalDeps({ platform: 'win32', processes }));
      const answer = await port.open({ ...WINDOWS_PANE, argv: ['claude', unsafe] });
      assert.equal(answer.kind, 'failed', unsafe);
      assert.deepEqual(processes.started, [], unsafe);
    }
    const processes = new FakeProcesses().onStart('cmd.exe', { kind: 'started', end: 'spawned' });
    const answer = await headlessPort(terminalDeps({ platform: 'win32', processes })).open({ ...WINDOWS_PANE, folder: 'C:\\R&D' });
    assert.equal(answer.kind, 'failed');
    assert.deepEqual(processes.started, []);
  });

  it('elsewhere starts a detached tmux session named after the title, in the pane folder', async () => {
    const processes = new FakeProcesses().onStart('tmux', { kind: 'started', end: 'exited' });
    assert.deepEqual(await headlessPort(terminalDeps({ processes })).open(PANE), { kind: 'opened', pane: 'teamrig-worker__p1_' });
    assert.deepEqual(processes.started, [
      { command: 'tmux', args: ['new-session', '-d', '-s', 'teamrig-worker__p1_', '-c', '/work/my repo', 'claude', '--resume'], cwd: '/work/my repo', mode: 'exit' },
    ]);
  });

  it('names a tmux session with letters, digits, _ and - alone, as tmux reads . and : as a pane address', () => {
    assert.equal(tmuxSessionOf('tr-host.ports:1 é'), 'teamrig-tr-host_ports_1__');
  });

  it('answers failed, with why, when tmux is missing or cannot start', async () => {
    assert.deepEqual(await headlessPort(terminalDeps()).open(PANE), { kind: 'failed', why: 'tmux is not installed, which a headless session needs on this system' });
    const failing = new FakeProcesses().onStart('tmux', { kind: 'failed', error: 'duplicate session' });
    assert.deepEqual(await headlessPort(terminalDeps({ processes: failing })).open(PANE), { kind: 'failed', why: 'duplicate session' });
  });

  it('serves open alone, answering unserved to every other request', async () => {
    const port = headlessPort(terminalDeps());
    assert.deepEqual((await port.capabilities()).requests, ['open']);
    assert.deepEqual(await port.focus('worker [p1]'), { kind: 'unserved' });
    assert.deepEqual(await port.list(), { kind: 'unserved' });
  });
});
