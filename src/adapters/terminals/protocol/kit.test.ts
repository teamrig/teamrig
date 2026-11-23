import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { referenceTerminal } from '../../../conformance/index.ts';
import { terminalProtocolHost } from '../../../testing/terminal-protocol-host.ts';
import type { Transport } from './client.ts';
import { kitWorld } from './kit.ts';

function wired(host: (line: string) => Promise<string>): Transport {
  return async (line) => ({ kind: 'answered', output: await host(line) });
}

/** A transport that answers each kit request with `results[method]`, as a program whose answers a case scripts. */
function scripted(results: Readonly<Record<string, string>>): Transport {
  return (line) => {
    const request: unknown = JSON.parse(line);
    const method = typeof request === 'object' && request !== null && 'method' in request && typeof request.method === 'string' ? request.method : '';
    const id = typeof request === 'object' && request !== null && 'id' in request && typeof request.id === 'number' ? request.id : 0;
    const result = results[method];
    return Promise.resolve(result === undefined ? { kind: 'failed', why: 'no script' } : { kind: 'answered', output: `{"jsonrpc":"2.0","id":${id},"result":${result}}` });
  };
}

const OPEN = { title: 'worker', folder: '/work/repo', argv: ['claude'], window: undefined, focus: 'take', identity: {}, wakeToken: 'token-of-worker' } as const;

describe('kitWorld', () => {
  it('reads through the wire what the terminal world holds, and scripts it the same', async () => {
    const { port, world } = referenceTerminal();
    const wire = kitWorld(wired(terminalProtocolHost(port, world)));
    const opened = await port.open({ ...OPEN, window: 'crew' });
    assert.equal(opened.kind, 'opened');
    const byHand = await wire.openByHand('guest');
    assert.deepEqual(await wire.panes(), await world.panes());
    assert.deepEqual((await wire.panes()).map((shown) => shown.window), ['crew', undefined]);
    assert.equal(await wire.front(), await world.front());
    await wire.put(byHand, 'busy');
    assert.deepEqual(await port.isIdle(byHand), { kind: 'state', state: 'busy' });
    await wire.put(byHand, 'idle');
    if (opened.kind === 'opened') {
      assert.deepEqual(await port.deliver(opened.pane, { token: 'token-of-worker', text: 'new work' }), { kind: 'delivered' });
      assert.deepEqual(await wire.wakes(opened.pane), ['new work']);
      await port.restart(opened.pane, true);
      assert.deepEqual(await wire.restarts(opened.pane), [true]);
    }
  });

  it('answers no pane in front as undefined', async () => {
    assert.equal(await kitWorld(scripted({ 'kit.front': '{"interface":"1.0","pane":null}' })).front(), undefined);
  });

  it('throws on every call to a program the kit did not start in kit mode', async () => {
    const { port } = referenceTerminal();
    const wire = kitWorld(wired(terminalProtocolHost(port)));
    const calls: readonly (() => Promise<unknown>)[] = [
      async () => wire.panes(),
      async () => wire.front(),
      async () => wire.put('pane-1', 'busy'),
      async () => wire.openByHand('guest'),
      async () => wire.wakes('pane-1'),
      async () => wire.restarts('pane-1'),
    ];
    for (const call of calls) {
      await assert.rejects(call, /serves no kit mode/);
    }
  });

  it('throws, so the case fails, on an answer the kit does not have', async () => {
    const wire = kitWorld(
      scripted({
        'kit.panes': '{"interface":"1.0","panes":[{"pane":"p","title":"t","folder":"/w","argv":["a"],"window":3}]}',
        'kit.front': '{"interface":"1.0","pane":""}',
        'kit.put': '{"interface":"1.0","kind":"opened"}',
        'kit.openByHand': '{"interface":"1.0"}',
        'kit.wakes': '{"interface":"1.0","texts":[1]}',
        'kit.restarts': '{"interface":"1.0","resumes":["yes"]}',
      }),
    );
    await assert.rejects(async () => wire.panes(), /kit\.panes: the terminal's answer is not one the kit has/);
    await assert.rejects(async () => wire.front(), /kit\.front/);
    await assert.rejects(async () => wire.put('p', 'busy'), /kit\.put/);
    await assert.rejects(async () => wire.openByHand('t'), /kit\.openByHand/);
    await assert.rejects(async () => wire.wakes('p'), /kit\.wakes/);
    await assert.rejects(async () => wire.restarts('p'), /kit\.restarts/);
    await assert.rejects(async () => kitWorld(scripted({ 'kit.panes': '{"interface":"1.0"}' })).panes(), /kit\.panes/);
  });

  it('throws with the why of a transport that got no answer, and of a program that failed, quoted', async () => {
    await assert.rejects(async () => kitWorld(() => Promise.resolve({ kind: 'failed', why: 'the program ran out of time' })).panes(), /kit\.panes: the program ran out of time/);
    await assert.rejects(async () => kitWorld(scripted({ 'kit.wakes': '{"interface":"1.0","kind":"failed","why":"no\\u0007such pane"}' })).wakes('p'), /kit\.wakes: the terminal failed: no such pane/);
    await assert.rejects(async () => kitWorld(scripted({ 'kit.wakes': '{"interface":"2.0","texts":[]}' })).wakes('p'), /kit\.wakes: the terminal's answer names no interface 1\.x version/);
  });
});
