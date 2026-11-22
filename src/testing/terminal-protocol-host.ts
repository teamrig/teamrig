import { INTERFACE_VERSION, isRecord, isTerminalRequest, type JsonRecord, type PaneIdentity, type TerminalPort } from '../plugin-api/index.ts';

/**
 * An outside terminal program, held in memory: it reads one JSON-RPC 2.0 request line of the terminal protocol, asks
 * `port` and writes the answer line back, each result carrying the interface version. A spec puts it at the far end
 * of a protocol client, so the terminal contract runs through the wire as it would against a real program.
 */
export function terminalProtocolHost(port: TerminalPort): (line: string) => Promise<string> {
  return async (line) => {
    const request = parsed(line);
    if (!isRecord(request) || request['jsonrpc'] !== '2.0' || typeof request['id'] !== 'number' || !isRecord(request['params'])) {
      return reply({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'not a JSON-RPC 2.0 request' } });
    }
    const { id, method, params } = request;
    const result = await answer(port, method, params);
    return reply(result === undefined ? { jsonrpc: '2.0', id, error: { code: -32601, message: `no method ${String(method)}` } } : { jsonrpc: '2.0', id, result: { ...result, interface: INTERFACE_VERSION } });
  };
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function reply(message: JsonRecord): string {
  return `${JSON.stringify(message)}\n`;
}

function text(params: JsonRecord, key: string): string {
  const value = params[key];
  return typeof value === 'string' ? value : '';
}

function identityOf(value: unknown): PaneIdentity {
  return isRecord(value) ? Object.fromEntries(Object.entries(value).flatMap(([key, label]) => (typeof label === 'string' ? [[key, label] as const] : []))) : {};
}

function argvOf(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((part) => typeof part === 'string') : [];
}

async function answer(port: TerminalPort, method: unknown, params: JsonRecord): Promise<JsonRecord | undefined> {
  if (method === 'capabilities') {
    return { ...(await port.capabilities()) };
  }
  if (!isTerminalRequest(method)) {
    return undefined;
  }
  const pane = text(params, 'pane');
  switch (method) {
    case 'open':
      return { ...(await port.open({
        title: text(params, 'title'),
        folder: text(params, 'folder'),
        argv: argvOf(params['argv']),
        window: typeof params['window'] === 'string' ? params['window'] : undefined,
        focus: params['focus'] === 'keep' ? 'keep' : 'take',
        identity: identityOf(params['identity']),
        wakeToken: text(params, 'wakeToken'),
      })) };
    case 'focus':
      return { ...(await port.focus(pane)) };
    case 'close':
      return { ...(await port.close(pane)) };
    case 'restart':
      return { ...(await port.restart(pane, params['resume'] === true)) };
    case 'rename':
      return { ...(await port.rename(pane, text(params, 'title'))) };
    case 'deliver':
      return { ...(await port.deliver(pane, { token: text(params, 'token'), text: text(params, 'text') })) };
    case 'isIdle':
      return { ...(await port.isIdle(pane)) };
    case 'list':
      return { ...(await port.list()) };
  }
}
