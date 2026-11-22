import { INTERFACE_MAJOR, isPaneState, isRecord, isStringArray, isTerminalRequest, parseInterfaceVersion, plainLine, } from "../../../plugin-api/index.js";
/** The most bytes an answer may hold. A list of a few hundred panes fits many times over; more is not a terminal's answer. */
export const ANSWER_CAP_BYTES = 1024 * 1024;
/** The most characters of a program's own text (a failure's why, a refusal) teamrig keeps to quote. */
export const QUOTE_CAP = 300;
const UNSERVED = { kind: 'unserved' };
export function failed(why) {
    return { kind: 'failed', why };
}
/** A program's own text as teamrig quotes it: one printable line, cut to `QUOTE_CAP`. */
export function quoted(text) {
    const line = plainLine(text);
    return line.length > QUOTE_CAP ? `${line.slice(0, QUOTE_CAP)}...` : line;
}
/** The request line for `method`, ending in a newline, the window of an open sent as null when it names none. */
export function requestLine(id, method, params) {
    return `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
}
export function openParams(request) {
    return { ...request, window: request['window'] ?? null };
}
export function deliverParams(pane, wake) {
    return { pane, token: wake.token, text: wake.text };
}
/**
 * Reads the program's output as the answer to request `id`. Refused: output past the cap, anything but one JSON
 * object, another id, a missing result, and a result that names no interface version of the major teamrig speaks.
 * A JSON-RPC error is the program's failure, its message quoted.
 */
export function replyOf(id, output) {
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
function parsed(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
/**
 * What a program serves, from its first answer. A request the protocol does not have is dropped, and an interface
 * text that names no version, so what teamrig uses is only what it knows. Undefined: the answer is no capabilities.
 */
export function capabilitiesOf(result) {
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
export function speaksOurMajor(capabilities) {
    return capabilities.interfaces.some((text) => parseInterfaceVersion(text)?.major === INTERFACE_MAJOR);
}
/** The answers every request may give besides its own: unserved, or failed with the program's why quoted. */
function commonAnswer(result) {
    if (result['kind'] === 'unserved') {
        return UNSERVED;
    }
    if (result['kind'] === 'failed') {
        return failed(typeof result['why'] === 'string' ? quoted(result['why']) : 'the terminal gave no reason');
    }
    return undefined;
}
function mismatch(method) {
    return failed(`the terminal's answer to ${method} is not one the protocol has`);
}
export function openAnswerOf(result) {
    if (result['kind'] === 'opened' && typeof result['pane'] === 'string' && result['pane'] !== '') {
        return { kind: 'opened', pane: result['pane'] };
    }
    return commonAnswer(result) ?? mismatch('open');
}
export function paneAnswerOf(method, result) {
    if (result['kind'] === 'done' || result['kind'] === 'gone') {
        return { kind: result['kind'] };
    }
    return commonAnswer(result) ?? mismatch(method);
}
export function deliverAnswerOf(result) {
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
export function idleAnswerOf(result) {
    if (result['kind'] === 'state' && isPaneState(result['state'])) {
        return { kind: 'state', state: result['state'] };
    }
    return commonAnswer(result) ?? mismatch('isIdle');
}
/** A pane's identity bag as the program sends it back: a label of strings only, never a proof of anything. */
function identityOf(value) {
    if (!isRecord(value)) {
        return undefined;
    }
    const entries = Object.entries(value);
    const strings = entries.flatMap(([key, text]) => (typeof text === 'string' ? [[key, text]] : []));
    return strings.length === entries.length ? Object.fromEntries(strings) : undefined;
}
function listedOf(value) {
    if (!isRecord(value) || typeof value['pane'] !== 'string' || value['pane'] === '' || !isPaneState(value['state'])) {
        return undefined;
    }
    const identity = identityOf(value['identity']);
    return identity === undefined ? undefined : { pane: value['pane'], state: value['state'], identity };
}
/** A list with one pane that is no pane is refused whole: teamrig re-links panes by this list, so it takes none it cannot read. */
export function listAnswerOf(result) {
    if (result['kind'] === 'listed' && Array.isArray(result['panes'])) {
        const panes = result['panes'].map(listedOf);
        const read = panes.filter((pane) => pane !== undefined);
        return read.length === panes.length ? { kind: 'listed', panes: read } : failed('the terminal listed a pane the protocol cannot read');
    }
    return commonAnswer(result) ?? mismatch('list');
}
