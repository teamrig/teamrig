import { isRecord, isStringArray, type JsonRecord, type KitRequest, type ShownPane, type TerminalWorld } from '../../../plugin-api/index.ts';
import type { Transport } from './client.ts';
import { quoted, replyOf, requestLine } from './wire.ts';

/**
 * The terminal world of an outside program in kit mode: each call is one of the kit's requests on the wire, and its
 * answer is checked as outside data. A call that gets no answer the protocol has throws, so the case running it fails;
 * a program serving no kit mode answers unserved, and every case that reads the world fails with that why.
 */
export function kitWorld(transport: Transport): TerminalWorld {
  let next = 0;
  const call = async (method: KitRequest, params: JsonRecord): Promise<JsonRecord> => {
    next += 1;
    const id = next;
    const answer = await transport(requestLine(id, method, params));
    if (answer.kind !== 'answered') {
      throw new Error(`${method}: ${answer.why}`);
    }
    const reply = replyOf(id, answer.output);
    if (reply.kind !== 'result') {
      throw new Error(`${method}: ${reply.why}`);
    }
    if (reply.result['kind'] === 'unserved') {
      throw new Error(`${method}: the terminal serves no kit mode`);
    }
    if (reply.result['kind'] === 'failed') {
      throw new Error(`${method}: the terminal failed: ${typeof reply.result['why'] === 'string' ? quoted(reply.result['why']) : 'no reason'}`);
    }
    return reply.result;
  };
  const wrong = (method: KitRequest): Error => new Error(`${method}: the terminal's answer is not one the kit has`);

  return {
    panes: async () => {
      const { panes } = await call('kit.panes', {});
      const read = Array.isArray(panes) ? panes.map(shownOf) : [undefined];
      if (read.some((pane) => pane === undefined)) {
        throw wrong('kit.panes');
      }
      return read.filter((pane) => pane !== undefined);
    },
    front: async () => {
      const { pane } = await call('kit.front', {});
      if (pane === null) {
        return undefined;
      }
      if (typeof pane !== 'string' || pane === '') {
        throw wrong('kit.front');
      }
      return pane;
    },
    put: async (pane, state) => {
      if ((await call('kit.put', { pane, state }))['kind'] !== 'done') {
        throw wrong('kit.put');
      }
    },
    openByHand: async (title) => {
      const { pane } = await call('kit.openByHand', { title });
      if (typeof pane !== 'string' || pane === '') {
        throw wrong('kit.openByHand');
      }
      return pane;
    },
    wakes: async (pane) => {
      const { texts } = await call('kit.wakes', { pane });
      if (!isStringArray(texts)) {
        throw wrong('kit.wakes');
      }
      return texts;
    },
    restarts: async (pane) => {
      const { resumes } = await call('kit.restarts', { pane });
      if (!isBooleans(resumes)) {
        throw wrong('kit.restarts');
      }
      return resumes;
    },
  };
}

/** One pane of a `kit.panes` answer, its window sent as null when it is in none teamrig named. */
function shownOf(value: unknown): ShownPane | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { pane, title, folder, argv, window } = value;
  if (typeof pane !== 'string' || pane === '' || typeof title !== 'string' || typeof folder !== 'string' || !isStringArray(argv) || (window !== null && typeof window !== 'string')) {
    return undefined;
  }
  return { pane, title, folder, argv, window: window ?? undefined };
}

function isBooleans(value: unknown): value is readonly boolean[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'boolean');
}
