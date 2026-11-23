import { errorMessage, isRecord } from "../core/guards.js";
import { TERMINAL_REQUESTS } from "../plugin-api/index.js";
import { importModule, loadTerminal } from "./loader.js";
/**
 * Loads the terminal adapter `id` and builds its port from what this run sees. It is asked for per call, never fixed
 * at start: a run opens a pane rarely, and the terminals it never asks for are never loaded. Never a throw: a terminal
 * teamrig cannot drive is one reason among those `teamrig open` gives, and the next terminal is tried.
 */
export async function terminalPortOf(id, deps, importer = importModule) {
    const load = await loadTerminal(id, importer);
    if (load.kind === 'refused') {
        return { kind: 'refused', why: `its adapter did not load: ${load.notices.join('; ')}` };
    }
    let built;
    try {
        built = load.value.create(deps);
    }
    catch (error) {
        return { kind: 'refused', why: `its adapter could not build its port: ${errorMessage(error)}` };
    }
    // `create` is typed, but the type holds only an adapter compiled against this release's ports, so what it built is read as a value.
    const port = isRecord(built) ? built['terminal'] : undefined;
    return isTerminalPort(port) ? { kind: 'port', port } : { kind: 'refused', why: 'its adapter builds no terminal port' };
}
/** Every call of a terminal port: its capabilities, then one per protocol request. */
const PORT_CALLS = ['capabilities', ...TERMINAL_REQUESTS];
function isTerminalPort(value) {
    return isRecord(value) && PORT_CALLS.every((call) => typeof value[call] === 'function');
}
