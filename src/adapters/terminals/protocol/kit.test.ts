import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { referenceTerminal } from '../../../conformance/index.ts';
import type { ProgramRunner } from '../../../plugin-api/index.ts';
import { terminalProgram, terminalProtocolHost } from '../../../testing/terminal-protocol-host.ts';
import type { Transport } from './client.ts';
import { kitLeaks, kitWorld } from './kit.ts';
import { pinnedTransport, sha256Of, type PinnedRunPorts, type ProgramPin } from './spawn.ts';

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

describe('kitWorld over a pinned program', () => {
  const BYTES = new TextEncoder().encode('the pinned program');
  const PIN: ProgramPin = { path: join(tmpdir(), 'pins', 'terminal-host'), sha256: sha256Of(BYTES), args: [] };

  function portsOver(run: ProgramRunner): PinnedRunPorts {
    return { read: async () => BYTES, stage: async (_bytes, sha256, name) => join(tmpdir(), 'staged', sha256, name), run, env: {} };
  }

  it('keeps one named world across runs, and a new name reaches a new, empty one', async () => {
    const program = terminalProgram(referenceTerminal);
    const ports = portsOver(program.run);
    const first = kitWorld(pinnedTransport(PIN, ports, { kitWorld: 'case-1' }));
    const pane = await first.openByHand('guest');
    assert.deepEqual((await first.panes()).map((shown) => shown.pane), [pane]);
    assert.deepEqual(await kitWorld(pinnedTransport(PIN, ports, { kitWorld: 'case-2' })).panes(), []);
    assert.deepEqual((await first.panes()).map((shown) => shown.pane), [pane]);
    assert.deepEqual(program.worlds, ['case-1', 'case-2']);
  });

  it('serves no kit request to a run started without kit mode', async () => {
    const program = terminalProgram(referenceTerminal);
    await assert.rejects(async () => kitWorld(pinnedTransport(PIN, portsOver(program.run))).panes(), /serves no kit mode/);
    assert.deepEqual(await kitLeaks(pinnedTransport(PIN, portsOver(program.run))), []);
    assert.deepEqual(program.worlds, []);
  });
});

describe('kitLeaks', () => {
  it('finds none in a program started without kit mode', async () => {
    assert.deepEqual(await kitLeaks(wired(terminalProtocolHost(referenceTerminal().port))), []);
  });

  it('names every kit request a program serves outside kit mode, with what it answered', async () => {
    const { port, world } = referenceTerminal();
    const leaks = await kitLeaks(wired(terminalProtocolHost(port, world)));
    assert.deepEqual(
      leaks.map((leak) => leak.method),
      ['kit.panes', 'kit.front', 'kit.put', 'kit.openByHand', 'kit.wakes', 'kit.restarts'],
    );
    assert.match(leaks[0]?.answer ?? '', /"panes":\[\]/);
  });

  it('counts a request with no answer, or one the protocol does not have, as a leak, never a pass', async () => {
    const leaks = await kitLeaks(scripted({ 'kit.panes': '{"interface":"1.0","kind":"unserved"}', 'kit.front': '{"interface":"2.0","kind":"unserved"}' }));
    assert.deepEqual(
      leaks.map((leak) => [leak.method, leak.answer]),
      [
        ['kit.front', "the terminal's answer names no interface 1.x version"],
        ['kit.put', 'no script'],
        ['kit.openByHand', 'no script'],
        ['kit.wakes', 'no script'],
        ['kit.restarts', 'no script'],
      ],
    );
  });
});
