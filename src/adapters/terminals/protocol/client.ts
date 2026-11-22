import { INTERFACE_VERSION, type JsonRecord, type TerminalCapabilities, type TerminalFailure, type TerminalPort, type TerminalRequest, type Unserved } from '../../../plugin-api/index.ts';
import {
  capabilitiesOf,
  deliverAnswerOf,
  deliverParams,
  failed,
  idleAnswerOf,
  listAnswerOf,
  openAnswerOf,
  openParams,
  paneAnswerOf,
  replyOf,
  requestLine,
  speaksOurMajor,
  type WireMethod,
} from './wire.ts';

/** What came back of one request line: the program's output, or why none came (it would not start, ran out of time). */
export type TransportAnswer = { readonly kind: 'answered'; readonly output: string } | TerminalFailure;

/**
 * How a request line reaches the outside program and its answer comes back. The pinned program run per request is
 * one; a spec's in-process server is another. It never throws: a failure is an answer.
 */
export type Transport = (line: string) => Promise<TransportAnswer>;

/** What teamrig knows of a program that answered no capabilities: it serves nothing, so nothing is asked of it. */
const NOTHING: TerminalCapabilities = { requests: [], interfaces: [], seesDraft: false };

const UNSERVED: Unserved = { kind: 'unserved' };

type Known = { readonly kind: 'known'; readonly capabilities: TerminalCapabilities } | TerminalFailure;

/**
 * A terminal reached through the terminal protocol: the port an outside program serves, so the same contract holds
 * it and a built-in terminal. Its first request asks what the program serves, once; a request it did not list answers
 * unserved without running the program, and one it cannot answer, because the program speaks no interface of teamrig's
 * major or answered no capabilities, answers failed with why. Every answer is checked as outside data (`wire.ts`).
 */
export function protocolTerminal(transport: Transport): TerminalPort {
  let next = 0;
  const call = async (method: WireMethod, params: JsonRecord): Promise<{ readonly kind: 'result'; readonly result: JsonRecord } | TerminalFailure> => {
    next += 1;
    const id = next;
    const answer = await transport(requestLine(id, method, params));
    return answer.kind === 'answered' ? replyOf(id, answer.output) : answer;
  };

  let known: Promise<Known> | undefined;
  const learn = async (): Promise<Known> => {
    const reply = await call('capabilities', { interface: INTERFACE_VERSION });
    if (reply.kind !== 'result') {
      return reply;
    }
    const capabilities = capabilitiesOf(reply.result);
    if (capabilities === undefined) {
      return failed("the terminal's first answer lists no capabilities");
    }
    return speaksOurMajor(capabilities) ? { kind: 'known', capabilities } : failed(`the terminal speaks no interface version of ${INTERFACE_VERSION}'s major`);
  };
  const knowing = (): Promise<Known> => {
    known ??= learn();
    return known;
  };

  /** Runs `method` if the program serves it and reads its result with `read`; else unserved, or failed with why. */
  const served = async <Answer>(method: TerminalRequest, params: JsonRecord, read: (result: JsonRecord) => Answer): Promise<Answer | Unserved | TerminalFailure> => {
    const state = await knowing();
    if (state.kind !== 'known') {
      return state;
    }
    if (!state.capabilities.requests.includes(method)) {
      return UNSERVED;
    }
    const reply = await call(method, params);
    return reply.kind === 'result' ? read(reply.result) : reply;
  };

  return {
    capabilities: async () => {
      const state = await knowing();
      return state.kind === 'known' ? state.capabilities : NOTHING;
    },
    open: (request) => served('open', openParams(request), openAnswerOf),
    focus: (pane) => served('focus', { pane }, (result) => paneAnswerOf('focus', result)),
    close: (pane) => served('close', { pane }, (result) => paneAnswerOf('close', result)),
    restart: (pane, resume) => served('restart', { pane, resume }, (result) => paneAnswerOf('restart', result)),
    rename: (pane, title) => served('rename', { pane, title }, (result) => paneAnswerOf('rename', result)),
    deliver: (pane, wake) => served('deliver', deliverParams(pane, wake), deliverAnswerOf),
    isIdle: (pane) => served('isIdle', { pane }, idleAnswerOf),
    list: () => served('list', {}, listAnswerOf),
  };
}
