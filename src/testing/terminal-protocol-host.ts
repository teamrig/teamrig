import { INTERFACE_VERSION, isKitRequest, isPaneState, isRecord, isTerminalRequest, KIT_MODE_ENV, type JsonRecord, type KitRequest, type PaneIdentity, type ProgramRunner, type TerminalPort, type TerminalWorld } from '../plugin-api/index.ts';

/**
 * An outside terminal program, held in memory: it reads one JSON-RPC 2.0 request line of the terminal protocol, asks
 * `port` and writes the answer line back, each result carrying the interface version. A spec puts it at the far end
 * of a protocol client, so the terminal contract runs through the wire as it would against a real program. Given a
 * `world` it is in kit mode and serves the kit's requests from it; without one it answers each unserved, as a program
 * the kit did not start does.
 */
export function terminalProtocolHost(port: TerminalPort, world?: TerminalWorld): (line: string) => Promise<string> {
  return async (line) => {
    const request = parsed(line);
    if (!isRecord(request) || request['jsonrpc'] !== '2.0' || typeof request['id'] !== 'number' || !isRecord(request['params'])) {
      return reply({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'not a JSON-RPC 2.0 request' } });
    }
    const { id, method, params } = request;
    const result = isKitRequest(method) ? await kitAnswer(world, method, params) : await answer(port, method, params);
    return reply(result === undefined ? { jsonrpc: '2.0', id, error: { code: -32601, message: `no method ${String(method)}` } } : { jsonrpc: '2.0', id, result: { ...result, interface: INTERFACE_VERSION } });
  };
}

/**
 * A pinned terminal program as the runner sees it, held in memory: each run answers its stdin line as
 * `terminalProtocolHost` does. Started with `KIT_MODE_ENV`, it serves the kit from the fake terminal that value names,
 * made by `make` the first time a name comes; started without, it answers from one terminal of its own, no kit request
 * served. `worlds` lists the names in the order they first came.
 */
export function terminalProgram(make: () => { readonly port: TerminalPort; readonly world: TerminalWorld }): { readonly run: ProgramRunner; readonly worlds: readonly string[] } {
  const named = new Map<string, (line: string) => Promise<string>>();
  const worlds: string[] = [];
  const production = terminalProtocolHost(make().port);
  const hostOf = (name: string | undefined): ((line: string) => Promise<string>) => {
    if (name === undefined) {
      return production;
    }
    const known = named.get(name);
    if (known !== undefined) {
      return known;
    }
    const { port, world } = make();
    const host = terminalProtocolHost(port, world);
    named.set(name, host);
    worlds.push(name);
    return host;
  };
  const run: ProgramRunner = async (request) => ({ end: { kind: 'exited', code: 0 }, stdout: await hostOf(request.env?.[KIT_MODE_ENV])(request.input ?? ''), stderr: '' });
  return { run, worlds };
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

async function kitAnswer(world: TerminalWorld | undefined, method: KitRequest, params: JsonRecord): Promise<JsonRecord> {
  if (world === undefined) {
    return { kind: 'unserved' };
  }
  const pane = text(params, 'pane');
  switch (method) {
    case 'kit.panes':
      return { panes: (await world.panes()).map((shown) => ({ ...shown, window: shown.window ?? null })) };
    case 'kit.front':
      return { pane: (await world.front()) ?? null };
    case 'kit.put': {
      const state = params['state'];
      if (!isPaneState(state)) {
        return { kind: 'failed', why: 'no such pane state' };
      }
      await world.put(pane, state);
      return { kind: 'done' };
    }
    case 'kit.openByHand':
      return { pane: await world.openByHand(text(params, 'title')) };
    case 'kit.wakes':
      return { texts: await world.wakes(pane) };
    case 'kit.restarts':
      return { resumes: await world.restarts(pane) };
  }
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
    case 'split':
      return { ...(await port.split({
        title: text(params, 'title'),
        folder: text(params, 'folder'),
        argv: argvOf(params['argv']),
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
