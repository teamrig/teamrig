import {
  INTERFACE_MAJOR,
  isPaneState,
  isRecord,
  isStringArray,
  isTerminalRequest,
  parseInterfaceVersion,
  plainLine,
  type DeliverAnswer,
  type IdleAnswer,
  type JsonRecord,
  type KitRequest,
  type ListAnswer,
  type ListedPane,
  type OpenAnswer,
  type PaneAnswer,
  type PaneIdentity,
  type PaneOpen,
  type PaneSplit,
  type SplitAnswer,
  type TerminalCapabilities,
  type TerminalFailure,
  type TerminalRequest,
  type Unserved,
  type Wake,
} from '../../../plugin-api/index.ts';

/**
 * The terminal protocol on the wire (docs/design/public-interface.md, Terminals as a protocol): one JSON-RPC 2.0
 * request a line to the program's standard input, one answer read back from its standard output. Every answer is
 * outside data: capped in size, checked field by field, its unknown fields ignored, its text kept to one printable line.
 */

/** The method of the first request, whose answer lists what the program serves; then the protocol's requests, and the kit's. */
export type WireMethod = 'capabilities' | TerminalRequest | KitRequest;

/** The most bytes an answer may hold. A list of a few hundred panes fits many times over; more is not a terminal's answer. */
export const ANSWER_CAP_BYTES = 1024 * 1024;

/** The most characters of a program's own text (a failure's why, a refusal) teamrig keeps to quote. */
export const QUOTE_CAP = 300;

const UNSERVED: Unserved = { kind: 'unserved' };

export function failed(why: string): TerminalFailure {
  return { kind: 'failed', why };
}

/** A program's own text as teamrig quotes it: one printable line, cut to `QUOTE_CAP`. */
export function quoted(text: string): string {
  const line = plainLine(text);
  return line.length > QUOTE_CAP ? `${line.slice(0, QUOTE_CAP)}...` : line;
}

/** The request line for `method`, ending in a newline, the window of an open sent as null when it names none. */
export function requestLine(id: number, method: WireMethod, params: JsonRecord): string {
  return `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
}

export function openParams(request: PaneOpen): JsonRecord {
  return { ...request, window: request['window'] ?? null };
}

export function splitParams(request: PaneSplit): JsonRecord {
  return { ...request };
}

export function deliverParams(pane: string, wake: Wake): JsonRecord {
  return { pane, token: wake.token, text: wake.text };
}

/** What one answer line holds once it is read as JSON-RPC: the result, or why it is no answer to request `id`. */
export type Reply = { readonly kind: 'result'; readonly result: JsonRecord } | TerminalFailure;

/**
 * Reads the program's output as the answer to request `id`. Refused: output past the cap, anything but one JSON
 * object, another id, a missing result, and a result that names no interface version of the major teamrig speaks.
 * A JSON-RPC error is the program's failure, its message quoted.
 */
export function replyOf(id: number, output: string): Reply {
  if (Buffer.byteLength(output, 'utf8') > ANSWER_CAP_BYTES) {
    return failed(`the terminal's answer is over ${ANSWER_CAP_BYTES} bytes`);
  }
  const message = parsed(output.trim());
  if (!isRecord(message) || message['jsonrpc'] !== '2.0') {
    return failed("the terminal's answer is not a JSON-RPC 2.0 message");
  }
  if (message['id'] !== id) {
    return failed(`the terminal answered another request than ${id}`);
  }
  if (isRecord(message['error'])) {
    const text = typeof message['error']['message'] === 'string' ? quoted(message['error']['message']) : 'no message';
    return failed(`the terminal refused the request: ${text}`);
  }
  if (!isRecord(message['result'])) {
    return failed("the terminal's answer holds no result");
  }
  const version = typeof message['result']['interface'] === 'string' ? parseInterfaceVersion(message['result']['interface']) : undefined;
  if (version?.major !== INTERFACE_MAJOR) {
    return failed(`the terminal's answer names no interface ${INTERFACE_MAJOR}.x version`);
  }
  return { kind: 'result', result: message['result'] };
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * What a program serves, from its first answer. A request the protocol does not have is dropped, and an interface
 * text that names no version, so what teamrig uses is only what it knows. Undefined: the answer is no capabilities.
 */
export function capabilitiesOf(result: JsonRecord): TerminalCapabilities | undefined {
  const { requests, interfaces, seesDraft } = result;
  if (!isStringArray(requests) || !isStringArray(interfaces) || typeof seesDraft !== 'boolean') {
    return undefined;
  }
  return {
    requests: [...new Set(requests.filter(isTerminalRequest))],
    interfaces: interfaces.filter((text) => parseInterfaceVersion(text) !== undefined),
    seesDraft,
  };
}

/** Whether the program speaks an interface version teamrig serves: one of its major. */
export function speaksOurMajor(capabilities: TerminalCapabilities): boolean {
  return capabilities.interfaces.some((text) => parseInterfaceVersion(text)?.major === INTERFACE_MAJOR);
}

/** The answers every request may give besides its own: unserved, or failed with the program's why quoted. */
function commonAnswer(result: JsonRecord): Unserved | TerminalFailure | undefined {
  if (result['kind'] === 'unserved') {
    return UNSERVED;
  }
  if (result['kind'] === 'failed') {
    return failed(typeof result['why'] === 'string' ? quoted(result['why']) : 'the terminal gave no reason');
  }
  return undefined;
}

function mismatch(method: WireMethod): TerminalFailure {
  return failed(`the terminal's answer to ${method} is not one the protocol has`);
}

export function openAnswerOf(result: JsonRecord): OpenAnswer {
  if (result['kind'] === 'opened' && typeof result['pane'] === 'string' && result['pane'] !== '') {
    return { kind: 'opened', pane: result['pane'] };
  }
  return commonAnswer(result) ?? mismatch('open');
}

export function splitAnswerOf(result: JsonRecord): SplitAnswer {
  if (result['kind'] === 'split') {
    return { kind: 'split' };
  }
  return commonAnswer(result) ?? mismatch('split');
}

export function paneAnswerOf(method: WireMethod, result: JsonRecord): PaneAnswer {
  if (result['kind'] === 'done' || result['kind'] === 'gone') {
    return { kind: result['kind'] };
  }
  // Only a focus can leave its pane selected behind another window; from any other request it is no answer.
  if (method === 'focus' && result['kind'] === 'selected') {
    return { kind: 'selected' };
  }
  return commonAnswer(result) ?? mismatch(method);
}

export function deliverAnswerOf(result: JsonRecord): DeliverAnswer {
  if (result['kind'] === 'delivered') {
    return { kind: 'delivered' };
  }
  if (result['kind'] === 'held' && isPaneState(result['why']) && result['why'] !== 'idle') {
    return { kind: 'held', why: result['why'] };
  }
  if (result['kind'] === 'refused') {
    return { kind: 'refused', why: typeof result['why'] === 'string' ? quoted(result['why']) : 'the terminal gave no reason' };
  }
  return commonAnswer(result) ?? mismatch('deliver');
}

export function idleAnswerOf(result: JsonRecord): IdleAnswer {
  if (result['kind'] === 'state' && isPaneState(result['state'])) {
    return { kind: 'state', state: result['state'] };
  }
  return commonAnswer(result) ?? mismatch('isIdle');
}

/** A pane's identity bag as the program sends it back: a label of strings only, never a proof of anything. */
function identityOf(value: unknown): PaneIdentity | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const entries = Object.entries(value);
  const strings = entries.flatMap(([key, text]) => (typeof text === 'string' ? [[key, text] as const] : []));
  return strings.length === entries.length ? Object.fromEntries(strings) : undefined;
}

function listedOf(value: unknown): ListedPane | undefined {
  if (!isRecord(value) || typeof value['pane'] !== 'string' || value['pane'] === '' || !isPaneState(value['state'])) {
    return undefined;
  }
  const identity = identityOf(value['identity']);
  return identity === undefined ? undefined : { pane: value['pane'], state: value['state'], identity };
}

/** A list with one pane that is no pane is refused whole: teamrig re-links panes by this list, so it takes none it cannot read. */
export function listAnswerOf(result: JsonRecord): ListAnswer {
  if (result['kind'] === 'listed' && Array.isArray(result['panes'])) {
    const panes = result['panes'].map(listedOf);
    const read = panes.filter((pane) => pane !== undefined);
    return read.length === panes.length ? { kind: 'listed', panes: read } : failed('the terminal listed a pane the protocol cannot read');
  }
  return commonAnswer(result) ?? mismatch('list');
}
