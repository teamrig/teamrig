import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TERMINAL_REQUESTS, type TerminalRequest } from '../../../plugin-api/index.ts';
import { TERMINAL_CONTRACT, bind, nothingTerminal, referenceTerminal, runCases, yesTerminal, type ReferenceOptions, type TerminalSubject } from '../../../conformance/index.ts';
import { terminalProtocolHost } from '../../../testing/terminal-protocol-host.ts';
import { protocolTerminal, type Transport } from './client.ts';
import { kitWorld } from './kit.ts';

/** The same terminal, reached through the protocol: its port and world served as an outside program in kit mode, the client and the kit's world in front of it. */
function overWire(subject: TerminalSubject): TerminalSubject {
  const host = terminalProtocolHost(subject.port, subject.world);
  const transport: Transport = async (line) => ({ kind: 'answered', output: await host(line) });
  return { port: protocolTerminal(transport), world: kitWorld(transport) };
}

async function failedCases(make: () => TerminalSubject): Promise<readonly string[]> {
  const results = await runCases(bind({ contract: TERMINAL_CONTRACT, make }).cases);
  return results.filter((result) => result.outcome.kind === 'failed').map((result) => result.id);
}

/** A transport that answers each method with `answers[method]` and counts the lines it was sent. */
function scripted(answers: Readonly<Record<string, string>>): { readonly transport: Transport; readonly methods: string[] } {
  const methods: string[] = [];
  const transport: Transport = (line) => {
    const request: unknown = JSON.parse(line);
    const method = typeof request === 'object' && request !== null && 'method' in request && typeof request.method === 'string' ? request.method : '';
    const id = typeof request === 'object' && request !== null && 'id' in request && typeof request.id === 'number' ? request.id : 0;
    methods.push(method);
    const result = answers[method];
    return Promise.resolve(result === undefined ? { kind: 'failed', why: 'no script' } : { kind: 'answered', output: `{"jsonrpc":"2.0","id":${id},"result":${result}}` });
  };
  return { transport, methods };
}

const CAPABLE = '{"interface":"1.0","requests":["open","focus"],"interfaces":["1.0"],"seesDraft":true}';

describe('protocolTerminal', () => {
  it('passes every case of the terminal contract against a terminal reached through the protocol', async () => {
    assert.deepEqual(await failedCases(() => overWire(referenceTerminal())), []);
  });

  const variants: readonly (readonly [string, ReferenceOptions])[] = [
    ...TERMINAL_REQUESTS.map((request): readonly [string, ReferenceOptions] => [`a lie on ${request}`, { lies: [request] }]),
    ['a terminal that serves open alone', { serves: ['open'] }],
    ['a terminal blind to drafts', { seesDraft: false }],
    ['an eager deliverer', { eager: true }],
    ['a terminal with one window', { oneWindow: true }],
  ];
  for (const [name, options] of variants) {
    it(`fails the same cases through the protocol as directly, for ${name}`, async () => {
      const direct = await failedCases(() => referenceTerminal(options));
      assert.notDeepEqual(direct, []);
      assert.deepEqual(await failedCases(() => overWire(referenceTerminal(options))), direct);
    });
  }

  for (const liar of [yesTerminal, nothingTerminal]) {
    it(`is caught through the protocol where ${liar.name} is caught directly`, async () => {
      const direct = await failedCases(liar);
      assert.notDeepEqual(direct, []);
      assert.deepEqual(await failedCases(() => overWire(liar())), direct);
    });
  }

  it('asks the program what it serves once, and runs it for no request it did not list', async () => {
    const { transport, methods } = scripted({ capabilities: CAPABLE, focus: '{"interface":"1.0","kind":"done"}' });
    const port = protocolTerminal(transport);
    const unlisted: readonly TerminalRequest[] = ['close', 'rename', 'list'];
    assert.deepEqual(await port.close('pane-1'), { kind: 'unserved' });
    assert.deepEqual(await port.rename('pane-1', 'new'), { kind: 'unserved' });
    assert.deepEqual(await port.list(), { kind: 'unserved' });
    assert.deepEqual(await port.focus('pane-1'), { kind: 'done' });
    assert.deepEqual(await port.capabilities(), { requests: ['open', 'focus'], interfaces: ['1.0'], seesDraft: true });
    assert.deepEqual(methods, ['capabilities', 'focus']);
    assert.equal(unlisted.some((request) => methods.includes(request)), false);
  });

  it('answers failed with the transport why, and claims nothing, when the program gives no first answer', async () => {
    const port = protocolTerminal(() => Promise.resolve({ kind: 'failed', why: 'the program ran out of time' }));
    assert.deepEqual(await port.focus('pane-1'), { kind: 'failed', why: 'the program ran out of time' });
    assert.deepEqual(await port.capabilities(), { requests: [], interfaces: [], seesDraft: false });
  });

  it('runs nothing past the first answer of a program that speaks no interface of our major', async () => {
    const { transport, methods } = scripted({ capabilities: '{"interface":"2.0","requests":["open","focus"],"interfaces":["2.0"],"seesDraft":true}' });
    const port = protocolTerminal(transport);
    assert.equal((await port.focus('pane-1')).kind, 'failed');
    assert.equal((await port.open({ title: 't', folder: '/w', argv: [], window: undefined, focus: 'take', identity: {}, wakeToken: 'k' })).kind, 'failed');
    assert.deepEqual(methods, ['capabilities']);
  });

  it('refuses a first answer that lists no capabilities, and a speaker of another major whose answer says 1.x', async () => {
    assert.deepEqual(await protocolTerminal(scripted({ capabilities: '{"interface":"1.0","requests":["open"]}' }).transport).focus('p'), {
      kind: 'failed',
      why: "the terminal's first answer lists no capabilities",
    });
    const other = protocolTerminal(scripted({ capabilities: '{"interface":"1.0","requests":["open"],"interfaces":["2.1"],"seesDraft":false}' }).transport);
    assert.equal((await other.focus('p')).kind, 'failed');
  });

  it('numbers each request line anew and refuses an answer to another one', async () => {
    const lines: string[] = [];
    const port = protocolTerminal((line) => {
      lines.push(line);
      return Promise.resolve({ kind: 'answered', output: lines.length === 1 ? `{"jsonrpc":"2.0","id":1,"result":${CAPABLE}}` : '{"jsonrpc":"2.0","id":1,"result":{"interface":"1.0","kind":"done"}}' });
    });
    assert.deepEqual(await port.focus('pane-1'), { kind: 'failed', why: 'the terminal answered another request than 2' });
    assert.deepEqual(
      lines.map((line) => line.endsWith('\n') && !line.slice(0, -1).includes('\n')),
      [true, true],
    );
  });
});
