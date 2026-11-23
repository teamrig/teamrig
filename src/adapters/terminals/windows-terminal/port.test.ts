import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PaneOpen } from '../../../plugin-api/index.ts';
import { terminalDeps } from '../../../testing/adapter-deps.ts';
import { FakeProcesses } from '../../../testing/fake-processes.ts';
import { launcherOf, windowsTerminalPort } from './port.ts';
import { FOCUS_EXIT, FOCUS_SCRIPT, FOCUS_TITLE_VAR, KEEP_FOCUS_ARGS_VAR, KEEP_FOCUS_EXIT, KEEP_FOCUS_PROGRAM_VAR, KEEP_FOCUS_SCRIPT } from './scripts.ts';

const TITLE = '[shop] api';
const ENV = { PATH: 'C:\\bin' };
const PANE: PaneOpen = {
  title: TITLE,
  folder: 'C:\\w\\shop dir\\',
  argv: ['C:\\node.exe', 'launch', 'say hi'],
  window: undefined,
  focus: 'take',
  identity: {},
  wakeToken: 'token',
};

function scriptOf(args: readonly string[]): string {
  return Buffer.from(args.at(-1) ?? '', 'base64').toString('utf16le');
}

function opened(processes: FakeProcesses): FakeProcesses {
  return processes.onStart('wt.exe', { kind: 'started', end: 'exited' });
}

describe('the Windows Terminal port', () => {
  it('opens a titled tab in the most recent window, in its folder, the command after --', async () => {
    const processes = opened(new FakeProcesses());
    assert.deepEqual(await windowsTerminalPort(terminalDeps({ processes })).open(PANE), { kind: 'opened', pane: TITLE });
    assert.deepEqual(processes.started, [
      { command: 'wt.exe', args: ['-w', '0', 'new-tab', '--title', TITLE, '-d', PANE.folder, '--', ...PANE.argv], cwd: PANE.folder, mode: 'exit' },
    ]);
    assert.deepEqual(processes.ran, []);
  });

  it("opens the tab in the window it names, made by that name when none is open (T1427)", async () => {
    const processes = opened(new FakeProcesses());
    await windowsTerminalPort(terminalDeps({ processes })).open({ ...PANE, window: 'teamrig-shop' });
    assert.deepEqual(processes.started[0]?.args.slice(0, 2), ['-w', 'teamrig-shop']);
  });

  it('will not hand Windows Terminal an argument it would split or expand, and starts nothing', async () => {
    for (const unsafe of ['a;b', 'say "hi"', '%PATH%', 'line\nbreak']) {
      const processes = opened(new FakeProcesses());
      const answer = await windowsTerminalPort(terminalDeps({ processes })).open({ ...PANE, argv: ['claude', unsafe] });
      assert.equal(answer.kind, 'failed', unsafe);
      assert.deepEqual(processes.started, []);
    }
    const answer = await windowsTerminalPort(terminalDeps()).open({ ...PANE, window: 'a;b' });
    assert.deepEqual(answer, { kind: 'failed', why: 'Windows Terminal would misread "a;b" (it holds ; " % or a control character)' });
  });

  it('answers failed, with why, when Windows Terminal is missing or its launcher fails', async () => {
    assert.deepEqual(await windowsTerminalPort(terminalDeps()).open(PANE), { kind: 'failed', why: 'Windows Terminal is not installed' });
    const failing = new FakeProcesses().onStart('wt.exe', { kind: 'failed', error: 'exited with code 1' });
    assert.deepEqual(await windowsTerminalPort(terminalDeps({ processes: failing })).open(PANE), { kind: 'failed', why: 'exited with code 1' });
  });

  it('keeps the focus through the script, the launcher and its command line as variables, never inside it (T2510)', async () => {
    const processes = new FakeProcesses().onRun('powershell.exe', { kind: 'exited', code: 0 });
    assert.deepEqual(await windowsTerminalPort(terminalDeps({ processes, env: ENV })).open({ ...PANE, focus: 'keep' }), { kind: 'opened', pane: TITLE });
    assert.deepEqual(processes.started, []);
    const [run] = processes.ran;
    assert.equal(run?.command, 'powershell.exe');
    assert.deepEqual(run?.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    assert.equal(scriptOf(run?.args ?? []), KEEP_FOCUS_SCRIPT);
    assert.equal(KEEP_FOCUS_SCRIPT.includes(TITLE), false);
    assert.deepEqual(run?.env, {
      ...ENV,
      [KEEP_FOCUS_PROGRAM_VAR]: 'wt.exe',
      [KEEP_FOCUS_ARGS_VAR]: '-w 0 new-tab --title "[shop] api" -d "C:\\w\\shop dir\\\\" -- C:\\node.exe launch "say hi"',
    });
    assert.equal(run?.cwd, PANE.folder);
  });

  it("reads each exit of the keep-focus script as the launch it was, starting nothing else", async () => {
    const cases = [
      [0, { kind: 'opened', pane: TITLE }],
      [KEEP_FOCUS_EXIT.focusLost, { kind: 'opened', pane: TITLE }],
      [KEEP_FOCUS_EXIT.running, { kind: 'opened', pane: TITLE }],
      [KEEP_FOCUS_EXIT.missing, { kind: 'failed', why: 'Windows Terminal is not installed' }],
      [KEEP_FOCUS_EXIT.launcherFailed, { kind: 'failed', why: 'wt.exe exited with an error' }],
      [1, { kind: 'failed', why: 'the script that keeps the focus failed (exit 1)' }],
    ] as const;
    for (const [code, expected] of cases) {
      const processes = new FakeProcesses().onRun('powershell.exe', { kind: 'exited', code });
      assert.deepEqual(await windowsTerminalPort(terminalDeps({ processes })).open({ ...PANE, focus: 'keep' }), expected, `exit ${code}`);
      assert.deepEqual(processes.started, [], `exit ${code} starts no plain launcher`);
    }
  });

  it('starts the launcher plainly when Windows PowerShell cannot run the keep-focus script', async () => {
    for (const unavailable of [{ kind: 'missing' }, { kind: 'failed', error: 'EACCES' }] as const) {
      const processes = opened(new FakeProcesses().onRun('powershell.exe', unavailable));
      assert.deepEqual(await windowsTerminalPort(terminalDeps({ processes })).open({ ...PANE, focus: 'keep' }), { kind: 'opened', pane: TITLE });
      assert.deepEqual(processes.started, [launcherOf(PANE)]);
    }
  });

  it("focuses the tab through the focus script, the title as a variable, run in teamrig's folder", async () => {
    const processes = new FakeProcesses();
    assert.deepEqual(await windowsTerminalPort(terminalDeps({ processes, env: ENV, cwd: 'C:\\team' })).focus(TITLE), { kind: 'done' });
    const [run] = processes.ran;
    assert.equal(scriptOf(run?.args ?? []), FOCUS_SCRIPT);
    assert.equal(FOCUS_SCRIPT.includes(TITLE), false);
    assert.deepEqual(run?.env, { ...ENV, [FOCUS_TITLE_VAR]: TITLE });
    assert.equal(run?.cwd, 'C:\\team');
  });

  it("answers gone when no tab has the title, and failed with why when the tab stayed behind another app's window or the script failed", async () => {
    const cases = [
      [{ kind: 'exited', code: FOCUS_EXIT.noTab }, { kind: 'gone' }],
      [{ kind: 'exited', code: FOCUS_EXIT.behind }, { kind: 'selected' }],
      [{ kind: 'exited', code: 1 }, { kind: 'failed', why: 'Windows Terminal could not be searched (exit 1)' }],
      [{ kind: 'missing' }, { kind: 'failed', why: 'Windows PowerShell is not installed' }],
      [{ kind: 'failed', error: 'EACCES' }, { kind: 'failed', why: 'EACCES' }],
    ] as const;
    for (const [outcome, expected] of cases) {
      const processes = new FakeProcesses().onRun('powershell.exe', outcome);
      assert.deepEqual(await windowsTerminalPort(terminalDeps({ processes })).focus(TITLE), expected, JSON.stringify(outcome));
    }
  });
});
