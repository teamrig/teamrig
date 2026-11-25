import assert from 'node:assert/strict';
import type { HookBridge, ObservedPermission, PermissionMode } from '../../plugin-api/index.ts';
import { defineContract, type ContractCase, type Subject } from '../contract.ts';

/** A hook input the host really sent, with the mode it was sent in under teamrig's name. */
export interface WorldModeInput {
  readonly input: string;
  readonly mode: PermissionMode;
}

/**
 * What a hook bridge sees of the permission mode: inputs the host really sent, and inputs the world writes in the
 * host's own shape, with a permission-mode word of the case's choosing or with none at all.
 */
export interface PermissionModeWorld {
  /** Recorded hook inputs, each with the mode the session ran in; at least one. */
  readonly recorded: readonly WorldModeInput[];
  /** A hook input of an event that carries a permission mode, holding `word` as it. */
  readonly withWord: (word: string) => string;
  /** A hook input of an event that carries none, though the session was launched in a mode. */
  readonly withoutMode: () => string;
}

/** The port's part the cases read: a hook input turned into an event. */
export type PermissionModePort = Pick<HookBridge, 'parse'>;
export type PermissionModeSubject = Subject<PermissionModePort, PermissionModeWorld>;
export type PermissionModeCase = ContractCase<PermissionModePort, PermissionModeWorld, 'host'>;

function permissionOf(port: PermissionModePort, raw: string): ObservedPermission | undefined {
  const event = port.parse(raw);
  assert.ok(event !== undefined, `the hook input ${raw.slice(0, 80)} is read as no event`);
  return event.permission;
}

/** Words no host maps: a recorded word's other case, a longer word it begins, and text that is no word at all. */
function lookalikesOf(word: string): readonly string[] {
  return [word.toUpperCase() === word ? word.toLowerCase() : word.toUpperCase(), `${word}Plus`, `x${word}`, '', 'mode\u0007'];
}

const CASES: readonly PermissionModeCase[] = [
  {
    id: 'permission-mode.reads-recorded',
    title: "reads the mode each recorded hook input was sent in, keeping the host's own word beside it",
    features: ['sessions.identity'],
    run: ({ port, world }) => {
      assert.ok(world.recorded.length > 0, 'the world holds no recorded input');
      for (const { input, mode } of world.recorded) {
        const permission = permissionOf(port, input);
        assert.ok(permission !== undefined, `a recorded input sent in ${mode} reads as no mode`);
        assert.equal(permission.mode, mode, `a recorded input sent in ${mode} reads as ${permission.mode}`);
        assert.notEqual(permission.hostWord, '', "the host's word is empty");
      }
    },
  },
  {
    id: 'permission-mode.exact-words',
    title: 'maps a word only by an exact, case-sensitive match, and keeps any other word as unmapped, never a guess',
    features: ['sessions.identity'],
    run: ({ port, world }) => {
      for (const { input } of world.recorded) {
        const recordedWord = permissionOf(port, input)?.hostWord ?? '';
        for (const word of lookalikesOf(recordedWord)) {
          assert.deepEqual(permissionOf(port, world.withWord(word)), { mode: 'unmapped', hostWord: word }, JSON.stringify(word));
        }
      }
    },
  },
  {
    id: 'permission-mode.untold',
    title: 'reports no mode for a hook input that carries none, never the mode the session was launched in',
    features: ['sessions.identity'],
    run: ({ port, world }) => {
      assert.equal(permissionOf(port, world.withoutMode()), undefined);
    },
  },
];

/** A recorded input sent in `ask`, a mode both liars get wrong. */
const WORLD: PermissionModeWorld = {
  recorded: [{ input: JSON.stringify({ event: 'tool-start', mode: 'default' }), mode: 'ask' }],
  withWord: (word) => JSON.stringify({ event: 'tool-start', mode: word }),
  withoutMode: () => JSON.stringify({ event: 'session-start' }),
};

/** A bare event a liar answers with, its permission its own. */
function eventWith(permission: ObservedPermission | undefined): ReturnType<HookBridge['parse']> {
  return {
    name: 'other',
    hostName: undefined,
    session: undefined,
    cwd: undefined,
    transcript: undefined,
    title: undefined,
    helper: undefined,
    call: undefined,
    prompt: undefined,
    lastReply: undefined,
    stopActive: false,
    source: undefined,
    reason: undefined,
    trigger: undefined,
    model: undefined,
    effort: undefined,
    permission,
    message: undefined,
    error: undefined,
  };
}

/** A liar that claims the port and tells nothing: every input is an event with no permission mode. */
export function nothingPermissionMode(): PermissionModeSubject {
  return { world: WORLD, port: { parse: () => eventWith(undefined) } };
}

/** A liar that says yes to all: every input reports the mode teamrig wants, whatever the host sent. */
export function yesPermissionMode(): PermissionModeSubject {
  return { world: WORLD, port: { parse: () => eventWith({ mode: 'auto', hostWord: 'auto' }) } };
}

/** What every host's hook bridge must do with the permission mode its hook input reports. */
export const PERMISSION_MODE_CONTRACT = defineContract<PermissionModePort, PermissionModeWorld, 'host'>({
  port: 'permission-mode',
  side: 'host',
  cases: CASES,
  liars: [nothingPermissionMode, yesPermissionMode],
});
