import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TerminalDeps } from '../plugin-api/index.ts';
import { FakeProcesses } from '../testing/fake-processes.ts';
import { terminalDeclarationData } from '../testing/manifests.ts';
import { TERMINAL_ADAPTERS } from './adapters.ts';
import type { ModuleImporter } from './loader.ts';
import { terminalPortOf } from './terminal-ports.ts';

function depsOf(processes = new FakeProcesses()): TerminalDeps {
  return { env: { RUN: 'one' }, platform: 'linux', processes, cwd: '/work' };
}

/** An importer serving a terminal entry named `tmux` whose `create` does `create`. */
function serving(create: (deps: TerminalDeps) => unknown): ModuleImporter {
  return () => Promise.resolve({ default: { declaration: terminalDeclarationData({ id: 'tmux' }), create } });
}

describe('terminalPortOf', () => {
  it('builds the port of every terminal teamrig ships with', async () => {
    for (const id of Object.keys(TERMINAL_ADAPTERS)) {
      const reach = await terminalPortOf(id, depsOf());
      assert.equal(reach.kind, 'port', id);
    }
  });

  it('builds the port from what the call hands it, and its open starts through those processes', async () => {
    const processes = new FakeProcesses().onStart('tmux', { kind: 'started', end: 'exited' });
    const reach = await terminalPortOf('tmux', depsOf(processes));
    assert.equal(reach.kind, 'port');
    if (reach.kind !== 'port') return;
    const opened = await reach.port.open({ title: 'alpha', folder: '/work/a', argv: ['node'], window: undefined, focus: 'take', identity: {}, wakeToken: 'token' });
    assert.deepEqual(opened, { kind: 'opened', pane: 'alpha' });
    assert.deepEqual(processes.started.map((request) => request.command), ['tmux']);
  });

  it('refuses an id no adapter has, with the ones there are', async () => {
    const reach = await terminalPortOf('kitty', depsOf());
    assert.deepEqual(reach, { kind: 'refused', why: `its adapter did not load: no terminal adapter is named kitty: the terminal adapters are ${Object.keys(TERMINAL_ADAPTERS).join(', ')}` });
  });

  it('refuses an adapter that builds no terminal port, or one missing a call', async () => {
    assert.deepEqual(await terminalPortOf('tmux', depsOf(), serving(() => ({}))), { kind: 'refused', why: 'its adapter builds no terminal port' });
    assert.deepEqual(await terminalPortOf('tmux', depsOf(), serving(() => ({ terminal: { open: () => undefined } }))), { kind: 'refused', why: 'its adapter builds no terminal port' });
  });

  it('refuses an adapter whose create throws, never throwing itself', async () => {
    const reach = await terminalPortOf(
      'tmux',
      depsOf(),
      serving(() => {
        throw new Error('no display');
      }),
    );
    assert.deepEqual(reach, { kind: 'refused', why: 'its adapter could not build its port: no display' });
  });
});
