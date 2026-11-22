import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PaneOpen } from '../../../plugin-api/index.ts';
import { terminalDeps } from '../../../testing/adapter-deps.ts';
import { FakeProcesses } from '../../../testing/fake-processes.ts';
import { macosTerminalPort } from './port.ts';

const PANE: PaneOpen = { title: 'worker [p1]', folder: '/work/my repo', argv: ['claude', "it's"], window: undefined, focus: 'take', identity: {}, wakeToken: 'token' };
const SCRIPT = ['-e', 'on run argv', '-e', 'tell application "Terminal"', '-e', 'activate', '-e', 'do script (item 1 of argv)', '-e', 'end tell', '-e', 'end run'];

describe('the macOS Terminal port', () => {
  it('opens a window that runs the command as quoted shell text, handed to AppleScript as its run argument', async () => {
    const processes = new FakeProcesses().onStart('osascript', { kind: 'started', end: 'exited' });
    assert.deepEqual(await macosTerminalPort(terminalDeps({ platform: 'darwin', processes })).open(PANE), { kind: 'opened', pane: 'worker [p1]' });
    assert.deepEqual(processes.started, [{ command: 'osascript', args: [...SCRIPT, "cd '/work/my repo' && 'claude' 'it'\\''s'"], cwd: '/work/my repo', mode: 'exit' }]);
  });

  it('brings Terminal forward only when the focus is taken', async () => {
    const processes = new FakeProcesses().onStart('osascript', { kind: 'started', end: 'exited' });
    await macosTerminalPort(terminalDeps({ platform: 'darwin', processes })).open({ ...PANE, focus: 'keep' });
    assert.equal(processes.started[0]?.args.includes('activate'), false);
  });

  it('answers failed, with why, when osascript is missing or fails', async () => {
    assert.deepEqual(await macosTerminalPort(terminalDeps()).open(PANE), { kind: 'failed', why: 'osascript is not installed' });
    const failing = new FakeProcesses().onStart('osascript', { kind: 'failed', error: 'exited with code 1: not authorized' });
    assert.deepEqual(await macosTerminalPort(terminalDeps({ processes: failing })).open(PANE), { kind: 'failed', why: 'exited with code 1: not authorized' });
  });

  it('serves open alone, answering unserved to every other request', async () => {
    const port = macosTerminalPort(terminalDeps());
    assert.deepEqual((await port.capabilities()).requests, ['open']);
    assert.deepEqual(await port.focus('worker'), { kind: 'unserved' });
    assert.deepEqual(await port.list(), { kind: 'unserved' });
  });
});
