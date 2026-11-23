import { errorMessage, isRecord } from '../core/guards.ts';
import { TERMINAL_REQUESTS, type TerminalDeps, type TerminalPort } from '../plugin-api/index.ts';
import { importModule, loadTerminal, type ModuleImporter } from './loader.ts';

/** The port of one terminal, or why teamrig cannot drive it: a refused load, or an adapter that builds no port. */
export type TerminalReach = { readonly kind: 'port'; readonly port: TerminalPort } | { readonly kind: 'refused'; readonly why: string };

/**
 * Loads the terminal adapter `id` and builds its port from what this run sees. It is asked for per call, never fixed
 * at start: a run opens a pane rarely, and the terminals it never asks for are never loaded. Never a throw: a terminal
 * teamrig cannot drive is one reason among those `teamrig open` gives, and the next terminal is tried.
 */
export async function terminalPortOf(id: string, deps: TerminalDeps, importer: ModuleImporter = importModule): Promise<TerminalReach> {
  const load = await loadTerminal(id, importer);
  if (load.kind === 'refused') {
    return { kind: 'refused', why: `its adapter did not load: ${load.notices.join('; ')}` };
  }
  let built: unknown;
  try {
    built = load.value.create(deps);
  } catch (error) {
    return { kind: 'refused', why: `its adapter could not build its port: ${errorMessage(error)}` };
  }
  // `create` is typed, but the type holds only an adapter compiled against this release's ports, so what it built is read as a value.
  const port = isRecord(built) ? built['terminal'] : undefined;
  return isTerminalPort(port) ? { kind: 'port', port } : { kind: 'refused', why: 'its adapter builds no terminal port' };
}

/** Every call of a terminal port: its capabilities, then one per protocol request. */
const PORT_CALLS = ['capabilities', ...TERMINAL_REQUESTS] as const;

function isTerminalPort(value: unknown): value is TerminalPort {
  return isRecord(value) && PORT_CALLS.every((call) => typeof value[call] === 'function');
}
