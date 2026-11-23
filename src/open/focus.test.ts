import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FOCUS_EXIT, FOCUS_TITLE_VAR } from '../adapters/terminals/windows-terminal/scripts.ts';
import type { ModuleImporter } from '../composition/loader.ts';
import { FakeProcesses } from '../testing/fake-processes.ts';
import { terminalDeclarationData } from '../testing/manifests.ts';
import { focusTab } from './focus.ts';
import type { OpenTabDeps } from './open-tab.ts';

const TITLE = '[app] alpha';
const ENV = { PATH: '/bin' };

function depsOf(processes: FakeProcesses, over: Partial<Omit<OpenTabDeps, 'processes'>> = {}): OpenTabDeps {
  return { processes, env: ENV, platform: 'win32', cwd: '/work', ...over };
}

describe('focusTab', () => {
  it("brings the tab to the front through Windows Terminal's port, handing it the title as a variable", async () => {
    const processes = new FakeProcesses();
    assert.deepEqual(await focusTab(depsOf(processes), 'auto', TITLE), { kind: 'focused', terminal: 'windows-terminal' });
    assert.equal(processes.ran[0]?.env[FOCUS_TITLE_VAR], TITLE);
    assert.equal(processes.ran[0]?.cwd, '/work');
  });

  it('says behind when the port answers the tab selected but kept behind another window', async () => {
    const processes = new FakeProcesses().onRun('powershell.exe', { kind: 'exited', code: FOCUS_EXIT.behind });
    assert.deepEqual(await focusTab(depsOf(processes), 'windows-terminal', TITLE), { kind: 'behind', terminal: 'windows-terminal' });
  });

  it("says why when no terminal has the tab, in the port's own words", async () => {
    const processes = new FakeProcesses().onRun('powershell.exe', { kind: 'exited', code: FOCUS_EXIT.noTab });
    assert.deepEqual(await focusTab(depsOf(processes), 'windows-terminal', TITLE), { kind: 'none', reasons: [`windows-terminal has no tab titled ${TITLE}`] });
    processes.onRun('powershell.exe', { kind: 'exited', code: 1 });
    assert.deepEqual(await focusTab(depsOf(processes), 'windows-terminal', TITLE), { kind: 'none', reasons: ['windows-terminal: Windows Terminal could not be searched (exit 1)'] });
    processes.onRun('powershell.exe', { kind: 'missing' });
    assert.deepEqual(await focusTab(depsOf(processes), 'windows-terminal', TITLE), { kind: 'none', reasons: ['windows-terminal: Windows PowerShell is not installed'] });
  });

  it('inside tmux tries its window first, then the platform terminal', async () => {
    const processes = new FakeProcesses().onRun('tmux', { kind: 'exited', code: 1 });
    const deps = depsOf(processes, { env: { ...ENV, TMUX: '/tmp/tmux-1/default,7,0' } });
    assert.deepEqual(await focusTab(deps, 'auto', TITLE), { kind: 'focused', terminal: 'windows-terminal' });
    assert.deepEqual(processes.ran.map((request) => request.command), ['tmux', 'powershell.exe']);
    assert.deepEqual(processes.ran[0]?.args, ['select-window', '-t', `=${TITLE}`]);
    processes.onRun('tmux', { kind: 'exited', code: 0 });
    assert.deepEqual(await focusTab({ ...deps, platform: 'linux' }, 'auto', TITLE), { kind: 'focused', terminal: 'tmux' });
  });

  it('names the terminals that select no tab by its title, and tries none for print', async () => {
    const processes = new FakeProcesses().onRun('tmux', { kind: 'exited', code: 1 });
    assert.deepEqual(await focusTab(depsOf(processes, { env: { TMUX: '/tmp/t,1,0' }, platform: 'linux' }), 'auto', TITLE), {
      kind: 'none',
      reasons: [`tmux has no tab titled ${TITLE}`, 'gnome-terminal, konsole, x-terminal-emulator cannot select a tab by its title'],
    });
    assert.deepEqual(await focusTab(depsOf(processes, { env: {}, platform: 'darwin' }), 'auto', TITLE), { kind: 'none', reasons: ['macos-terminal cannot select a tab by its title'] });
    assert.deepEqual(await focusTab(depsOf(processes, { env: {} }), 'print', TITLE), { kind: 'none', reasons: ['the terminal setting is print'] });
    assert.equal(processes.ran.length, 1);
  });

  it('names a terminal teamrig cannot drive, running nothing', async () => {
    const processes = new FakeProcesses();
    const importer: ModuleImporter = () => Promise.resolve({ default: { declaration: terminalDeclarationData({ id: 'tmux' }), create: () => ({}) } });
    assert.deepEqual(await focusTab(depsOf(processes, { importer }), 'tmux', TITLE), { kind: 'none', reasons: ['tmux: its adapter builds no terminal port'] });
    assert.equal(processes.ran.length, 0);
  });
});
