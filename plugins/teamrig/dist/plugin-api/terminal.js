/**
 * A terminal as teamrig drives it: the port a terminal's adapter serves, request for request the terminal protocol
 * of `docs/design/public-interface.md`. A built-in terminal serves it inside teamrig; an outside program is reached
 * through the protocol by a client that serves this same port, so one contract holds both.
 */
/** The protocol's requests, by the names they have on the wire. */
export const TERMINAL_REQUESTS = ['open', 'split', 'focus', 'close', 'restart', 'rename', 'deliver', 'isIdle', 'list'];
export function isTerminalRequest(value) {
    return TERMINAL_REQUESTS.some((request) => request === value);
}
/**
 * What a pane is doing: `idle` only when no turn runs, no question shows and its input holds nothing unsent. A
 * person typing into the input is using the pane, so `draft` is not idle.
 */
export const PANE_STATES = ['idle', 'busy', 'asking', 'draft', 'gone'];
export function isPaneState(value) {
    return PANE_STATES.some((state) => state === value);
}
/**
 * The kit's requests: one per call of a terminal world, so the conformance kit can run the terminal contract against
 * an outside program. A program serves them only when the kit starts it with `KIT_MODE_ENV` set, and then over a fake
 * terminal of its own, never the real one; without it each answers unserved. teamrig itself never sets it.
 */
export const KIT_REQUESTS = ['kit.panes', 'kit.front', 'kit.put', 'kit.openByHand', 'kit.wakes', 'kit.restarts'];
export function isKitRequest(value) {
    return KIT_REQUESTS.some((request) => request === value);
}
/**
 * The environment variable the kit starts a terminal program with to have it serve `KIT_REQUESTS`. Its value names the
 * fake terminal the requests reach: the program runs once per request, so it keeps each named one's panes between its
 * runs, and a name it has not seen is a new, empty one. The kit gives each case a new name, so no state passes from
 * one case to the next.
 */
export const KIT_MODE_ENV = 'TEAMRIG_KIT';
