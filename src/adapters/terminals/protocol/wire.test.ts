import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANSWER_CAP_BYTES,
  QUOTE_CAP,
  capabilitiesOf,
  deliverAnswerOf,
  idleAnswerOf,
  listAnswerOf,
  openAnswerOf,
  openParams,
  paneAnswerOf,
  replyOf,
  requestLine,
} from './wire.ts';

const RESULT = { interface: '1.0', kind: 'done' };

function line(message: unknown): string {
  return JSON.stringify(message);
}

describe('the terminal protocol wire', () => {
  it('writes one JSON-RPC 2.0 request a line, the window of an open sent as null when it names none', () => {
    const open = openParams({ title: 't', folder: '/w', argv: ['a'], window: undefined, focus: 'take', identity: { session: 's' }, wakeToken: 'k' });
    const written = requestLine(7, 'open', open);
    assert.equal(written.endsWith('\n'), true);
    assert.deepEqual(JSON.parse(written), { jsonrpc: '2.0', id: 7, method: 'open', params: { title: 't', folder: '/w', argv: ['a'], window: null, focus: 'take', identity: { session: 's' }, wakeToken: 'k' } });
  });

  it('reads the result of the request it sent, whatever else the answer holds', () => {
    assert.deepEqual(replyOf(3, line({ jsonrpc: '2.0', id: 3, result: { ...RESULT, extra: 1 }, other: true })), { kind: 'result', result: { ...RESULT, extra: 1 } });
  });

  const refused: readonly (readonly [string, string, string])[] = [
    ['text that is no JSON', 'not json', "the terminal's answer is not a JSON-RPC 2.0 message"],
    ['another JSON-RPC version', line({ jsonrpc: '1.0', id: 1, result: RESULT }), "the terminal's answer is not a JSON-RPC 2.0 message"],
    ['an answer to another request', line({ jsonrpc: '2.0', id: 2, result: RESULT }), 'the terminal answered another request than 1'],
    ['no result', line({ jsonrpc: '2.0', id: 1 }), "the terminal's answer holds no result"],
    ['a result naming no interface', line({ jsonrpc: '2.0', id: 1, result: { kind: 'done' } }), "the terminal's answer names no interface 1.x version"],
    ['a result of another major', line({ jsonrpc: '2.0', id: 1, result: { interface: '2.0', kind: 'done' } }), "the terminal's answer names no interface 1.x version"],
    ['a result whose version is no version', line({ jsonrpc: '2.0', id: 1, result: { interface: '1.x', kind: 'done' } }), "the terminal's answer names no interface 1.x version"],
  ];
  for (const [name, output, why] of refused) {
    it(`refuses ${name}`, () => {
      assert.deepEqual(replyOf(1, output), { kind: 'failed', why });
    });
  }

  it('refuses an answer past the cap before reading it', () => {
    const big = line({ jsonrpc: '2.0', id: 1, result: { ...RESULT, pad: 'x'.repeat(ANSWER_CAP_BYTES) } });
    assert.deepEqual(replyOf(1, big), { kind: 'failed', why: `the terminal's answer is over ${ANSWER_CAP_BYTES} bytes` });
  });

  it("quotes a JSON-RPC error's message as one printable line, cut to the cap", () => {
    assert.deepEqual(replyOf(1, line({ jsonrpc: '2.0', id: 1, error: { code: 1, message: 'bad\u001b[31m\nthing' } })), { kind: 'failed', why: 'the terminal refused the request: bad [31m thing' });
    const long = replyOf(1, line({ jsonrpc: '2.0', id: 1, error: { code: 1, message: 'y'.repeat(QUOTE_CAP * 2) } }));
    assert.equal(long.kind === 'failed' && long.why.length, 'the terminal refused the request: '.length + QUOTE_CAP + 3);
  });

  it('keeps of a capabilities answer only the requests the protocol has and the texts that are versions', () => {
    assert.deepEqual(capabilitiesOf({ requests: ['open', 'paint', 'open', 'list'], interfaces: ['1.0', 'one', '1.2'], seesDraft: false }), { requests: ['open', 'list'], interfaces: ['1.0', '1.2'], seesDraft: false });
    assert.equal(capabilitiesOf({ requests: ['open'], interfaces: ['1.0'] }), undefined);
    assert.equal(capabilitiesOf({ requests: 'open', interfaces: ['1.0'], seesDraft: true }), undefined);
  });

  it('reads each answer kind its request may give, and unserved or a quoted failure for any', () => {
    assert.deepEqual(openAnswerOf({ kind: 'opened', pane: 'p1', more: 1 }), { kind: 'opened', pane: 'p1' });
    assert.deepEqual(paneAnswerOf('close', { kind: 'gone' }), { kind: 'gone' });
    assert.deepEqual(paneAnswerOf('focus', { kind: 'selected' }), { kind: 'selected' });
    assert.deepEqual(deliverAnswerOf({ kind: 'held', why: 'draft' }), { kind: 'held', why: 'draft' });
    assert.deepEqual(deliverAnswerOf({ kind: 'refused', why: 'wrong\ttoken' }), { kind: 'refused', why: 'wrong token' });
    assert.deepEqual(idleAnswerOf({ kind: 'state', state: 'asking' }), { kind: 'state', state: 'asking' });
    assert.deepEqual(listAnswerOf({ kind: 'listed', panes: [{ pane: 'p1', state: 'busy', identity: { session: 's' }, extra: 1 }] }), { kind: 'listed', panes: [{ pane: 'p1', state: 'busy', identity: { session: 's' } }] });
    assert.deepEqual(focusOf({ kind: 'unserved' }), { kind: 'unserved' });
    assert.deepEqual(focusOf({ kind: 'failed', why: 'no\u0007window' }), { kind: 'failed', why: 'no window' });
    assert.deepEqual(focusOf({ kind: 'failed' }), { kind: 'failed', why: 'the terminal gave no reason' });
  });

  const mismatched: readonly (readonly [string, () => { readonly kind: string }])[] = [
    ['an open with an empty pane id', () => openAnswerOf({ kind: 'opened', pane: '' })],
    ['a pane request answered delivered', () => paneAnswerOf('focus', { kind: 'delivered' })],
    ['a close answered selected, which only a focus answers', () => paneAnswerOf('close', { kind: 'selected' })],
    ['a wake held by idle, which never holds one', () => deliverAnswerOf({ kind: 'held', why: 'idle' })],
    ['a wake held by a state the protocol lacks', () => deliverAnswerOf({ kind: 'held', why: 'sleepy' })],
    ['an idle answer of a state the protocol lacks', () => idleAnswerOf({ kind: 'state', state: 'sleepy' })],
    ['a list holding one pane with a state the protocol lacks', () => listAnswerOf({ kind: 'listed', panes: [{ pane: 'p1', state: 'idle', identity: {} }, { pane: 'p2', state: 'sleepy', identity: {} }] })],
    ['a list holding one pane whose identity is not text', () => listAnswerOf({ kind: 'listed', panes: [{ pane: 'p1', state: 'idle', identity: { role: 1 } }] })],
    ['a list that is no list', () => listAnswerOf({ kind: 'listed', panes: 'p1' })],
  ];
  for (const [name, read] of mismatched) {
    it(`answers failed for ${name}`, () => {
      assert.equal(read().kind, 'failed');
    });
  }
});

function focusOf(result: Readonly<Record<string, unknown>>): { readonly kind: string } {
  return paneAnswerOf('focus', result);
}
