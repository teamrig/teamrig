import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ModuleImporter } from '../composition/loader.ts';
import type { PaneOpen } from '../plugin-api/index.ts';
import { FakeProcesses } from '../testing/fake-processes.ts';
import { terminalDeclarationData } from '../testing/manifests.ts';
import { mintWakeToken, openedWords, openSplit, openTab } from './open-tab.ts';
import type { TabRequest } from './terminals.ts';

const TAB: TabRequest = { title: 'shop-api', folder: '/w/shop', argv: ['/usr/bin/node', '/kit/main.js', 'launch', 'api'], window: undefined, focus: 'take' };
const CWD = '/work';

/** An importer serving a tmux adapter whose port records each open it is asked for and answers `answer`. */
function recordingTmux(opened: PaneOpen[], answer: unknown): ModuleImporter {
  const unserved = async () => ({ kind: 'unserved' });
  const port = {
    capabilities: async () => ({ requests: ['open'], interfaces: ['1.0'], seesDraft: false }),
    open: async (request: PaneOpen) => {
      opened.push(request);
      return answer;
    },
    split: unserved,
    focus: unserved,
    close: unserved,
    restart: unserved,
    rename: unserved,
    deliver: unserved,
    isIdle: unserved,
    list: unserved,
  };
  return () => Promise.resolve({ default: { declaration: terminalDeclarationData({ id: 'tmux' }), create: () => ({ terminal: port }) } });
}

describe('openTab', () => {
  it('opens in the first terminal auto finds, after one that is missing', async () => {
    const processes = new FakeProcesses().onStart('konsole', { kind: 'started', end: 'running' });
    const outcome = await openTab({ processes, env: {}, platform: 'linux', cwd: CWD }, 'auto', TAB);
    assert.deepEqual(outcome, { kind: 'opened', terminal: 'konsole', pane: 'shop-api' }, "it gives the terminal's id of the tab");
    assert.deepEqual(
      processes.started.map((request) => request.command),
      ['gnome-terminal', 'konsole'],
    );
  });

  it('gives every reason when no terminal opens the tab', async () => {
    const processes = new FakeProcesses().onStart('tmux', { kind: 'failed', error: 'exited with code 1: no server running' });
    const outcome = await openTab({ processes, env: { TMUX: 'x' }, platform: 'win32', cwd: CWD }, 'auto', { ...TAB, folder: 'C:\\a;b' });
    assert.deepEqual(outcome, {
      kind: 'none',
      reasons: ['tmux: exited with code 1: no server running', 'windows-terminal: Windows Terminal would misread "C:\\\\a;b" (it holds ; " % or a control character)'],
    });
  });

  it('tries only the terminal asked for', async () => {
    const processes = new FakeProcesses();
    const outcome = await openTab({ processes, env: { TMUX: 'x' }, platform: 'linux', cwd: CWD }, 'x-terminal-emulator', TAB);
    assert.equal(outcome.kind, 'none');
    assert.equal(processes.started.length, 1);
  });

  it("hands the terminal's port the tab as asked, with a fresh wake token for each pane", async () => {
    const opened: PaneOpen[] = [];
    const deps = { processes: new FakeProcesses(), env: {}, platform: 'linux' as const, cwd: CWD, importer: recordingTmux(opened, { kind: 'opened', pane: '%7' }) };
    assert.deepEqual(await openTab(deps, 'tmux', TAB), { kind: 'opened', terminal: 'tmux', pane: '%7' });
    await openTab(deps, 'tmux', { ...TAB, focus: 'keep', window: 'teamrig-shop' });
    assert.deepEqual(
      opened.map(({ wakeToken: _token, ...rest }) => rest),
      [
        { ...TAB, identity: {} },
        { ...TAB, focus: 'keep', window: 'teamrig-shop', identity: {} },
      ],
    );
    assert.notEqual(opened[0]?.wakeToken, opened[1]?.wakeToken, 'no two panes share a token');
  });

  it('says so of a terminal whose port opens no tab, or whose adapter does not load', async () => {
    const unserved = { processes: new FakeProcesses(), env: {}, platform: 'linux' as const, cwd: CWD, importer: recordingTmux([], { kind: 'unserved' }) };
    assert.deepEqual(await openTab(unserved, 'tmux', TAB), { kind: 'none', reasons: ['tmux opens no tab'] });
    const missing: ModuleImporter = () => Promise.reject(new Error('gone'));
    assert.deepEqual(await openTab({ ...unserved, importer: missing }, 'tmux', TAB), { kind: 'none', reasons: ['tmux: its adapter did not load: its index.ts did not load: gone'] });
  });

  it('starts nothing for print', async () => {
    const processes = new FakeProcesses().onStart('wt.exe', { kind: 'started', end: 'exited' });
    assert.deepEqual(await openTab({ processes, env: {}, platform: 'win32', cwd: CWD }, 'print', TAB), { kind: 'none', reasons: ['the terminal setting is print'] });
    assert.deepEqual(processes.started, []);
  });
});

describe('openSplit (T5105)', () => {
  it('splits the tmux the run works in, whatever terminal the platform has', async () => {
    const processes = new FakeProcesses().onStart('tmux', { kind: 'started', end: 'exited' });
    const outcome = await openSplit({ processes, env: { TMUX: 'x', WT_SESSION: 'guid' }, platform: 'win32', cwd: TAB.folder }, { ...TAB, focus: 'keep' });
    assert.deepEqual(outcome, { kind: 'opened', terminal: 'tmux' });
    assert.deepEqual(processes.started.map((request) => request.args.slice(0, 3)), [['split-window', '-h', '-d']]);
  });

  it('splits Windows Terminal inside it, with no focus script: the split raises no other window', async () => {
    const processes = new FakeProcesses().onStart('wt.exe', { kind: 'started', end: 'exited' });
    const outcome = await openSplit({ processes, env: { WT_SESSION: 'guid' }, platform: 'win32', cwd: TAB.folder }, { ...TAB, focus: 'keep' });
    assert.deepEqual(outcome, { kind: 'opened', terminal: 'windows-terminal' });
    assert.deepEqual(processes.started.map((request) => request.args.slice(0, 3)), [['-w', '0', 'split-pane']]);
    assert.deepEqual(processes.ran, []);
  });

  it('starts nothing in a terminal that cannot split, saying so, and says why a split failed', async () => {
    const outside = new FakeProcesses().onStart('wt.exe', { kind: 'started', end: 'exited' });
    assert.deepEqual(await openSplit({ processes: outside, env: {}, platform: 'win32', cwd: TAB.folder }, TAB), {
      kind: 'none',
      reasons: ['this terminal is neither tmux nor Windows Terminal, the ones that split'],
    });
    assert.deepEqual(outside.started, []);
    assert.deepEqual(await openSplit({ processes: new FakeProcesses(), env: { TMUX: 'x' }, platform: 'linux', cwd: TAB.folder }, TAB), { kind: 'none', reasons: ['tmux: tmux is not installed'] });
  });

  it('says so of a terminal whose port splits no pane (T5236)', async () => {
    const deps = { processes: new FakeProcesses(), env: { TMUX: 'x' }, platform: 'linux' as const, cwd: CWD, importer: recordingTmux([], { kind: 'opened', pane: '%7' }) };
    assert.deepEqual(await openSplit(deps, TAB), { kind: 'none', reasons: ['tmux splits no pane'] });
  });

  it("says why Windows Terminal's port refused a split it would misread, and starts nothing (T5236)", async () => {
    const processes = new FakeProcesses().onStart('wt.exe', { kind: 'started', end: 'exited' });
    const outcome = await openSplit({ processes, env: { WT_SESSION: 'guid' }, platform: 'win32', cwd: TAB.folder }, { ...TAB, folder: 'C:\\a;b' });
    assert.equal(outcome.kind, 'none');
    assert.deepEqual(processes.started, []);
  });
});

describe('mintWakeToken', () => {
  it('is 32 random bytes as base64url, new each time', () => {
    const token = mintWakeToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(mintWakeToken(), token);
  });
});

describe('openedWords', () => {
  it('names the terminal that opened the tab, for the restore log (T1705)', () => {
    assert.equal(openedWords({ kind: 'opened', terminal: 'windows-terminal', pane: '[app] alpha' }), 'windows-terminal opened it');
  });
});
