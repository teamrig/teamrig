import assert from 'node:assert/strict';
import { defineContract } from "../contract.js";
function permissionOf(port, raw) {
    const event = port.parse(raw);
    assert.ok(event !== undefined, `the hook input ${raw.slice(0, 80)} is read as no event`);
    return event.permission;
}
/** Words no host maps: a recorded word's other case, a longer word it begins, and text that is no word at all. */
function lookalikesOf(word) {
    return [word.toUpperCase() === word ? word.toLowerCase() : word.toUpperCase(), `${word}Plus`, `x${word}`, '', 'mode\u0007'];
}
const CASES = [
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
const WORLD = {
    recorded: [{ input: JSON.stringify({ event: 'tool-start', mode: 'default' }), mode: 'ask' }],
    withWord: (word) => JSON.stringify({ event: 'tool-start', mode: word }),
    withoutMode: () => JSON.stringify({ event: 'session-start' }),
};
/** A bare event a liar answers with, its permission its own. */
function eventWith(permission) {
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
        hostPrompt: false,
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
export function nothingPermissionMode() {
    return { world: WORLD, port: { parse: () => eventWith(undefined) } };
}
/** A liar that says yes to all: every input reports the mode teamrig wants, whatever the host sent. */
export function yesPermissionMode() {
    return { world: WORLD, port: { parse: () => eventWith({ mode: 'auto', hostWord: 'auto' }) } };
}
/** What every host's hook bridge must do with the permission mode its hook input reports. */
export const PERMISSION_MODE_CONTRACT = defineContract({
    port: 'permission-mode',
    side: 'host',
    cases: CASES,
    liars: [nothingPermissionMode, yesPermissionMode],
});
