import assert from 'node:assert/strict';
import { defineContract } from "../contract.js";
/** A step a notice can quote: some text, on one line. */
function assertStep(step, what) {
    assert.notEqual(step.trim(), '', `the step that ${what} is empty`);
    assert.ok(!/[\r\n]/.test(step), `the step that ${what} spans lines`);
}
const CASES = [
    {
        id: 'steps.session',
        title: 'names, on one line each, the steps typed in a session to reload its plugins, end it and run a plugin command',
        features: ['plugin.install-update', 'sessions.in-tab'],
        run: ({ port, world }) => {
            assertStep(port.reloadPlugins, 'reloads the plugins');
            assertStep(port.exit, 'ends a session');
            assertStep(port.pluginCommand(world.plugin), "runs a plugin's command");
            assert.notEqual(port.reloadPlugins, port.exit, 'reloading and ending a session share one step');
            assert.ok(port.pluginCommand(world.plugin).includes(world.plugin), `the step that runs ${world.plugin}'s command does not name it`);
        },
    },
    {
        id: 'steps.terminal',
        title: 'names, on one line each, the commands that resume a session, update a plugin and update the host, each naming what it acts on',
        features: ['plugin.install-update', 'sessions.resume'],
        run: ({ port, world }) => {
            assertStep(port.resume(world.session), 'resumes a session');
            assert.ok(port.resume(world.session).includes(world.session), `the step that resumes ${world.session} does not name it`);
            const update = port.updatePlugin(world.plugin, world.marketplace);
            assertStep(update, 'updates a plugin');
            assert.ok(update.includes(world.plugin) && update.includes(world.marketplace), `the step that updates ${world.plugin} does not name it and ${world.marketplace}`);
            assertStep(port.updateHost, 'updates the host');
            assert.notEqual(port.updateHost, update, 'updating the host and the plugin share one step');
        },
    },
];
/** The liars' world: names no liar's fixed answer holds. */
const WORLD = { session: 'session-one', plugin: 'plugin-one', marketplace: 'market-one' };
/** A liar that claims the port and names nothing: every step is empty. */
export function nothingSteps() {
    return {
        world: WORLD,
        port: { reloadPlugins: '', exit: '', pluginCommand: () => '', resume: () => '', updatePlugin: () => '', updateHost: '' },
    };
}
/** A liar with one fixed step for everything, naming nothing it acts on. */
export function yesSteps() {
    return {
        world: WORLD,
        port: { reloadPlugins: 'do it', exit: 'do it', pluginCommand: () => 'do it', resume: () => 'do it', updatePlugin: () => 'do it', updateHost: 'do it' },
    };
}
/** What every host's steps port must name for teamrig's notices to tell its person what to type. */
export const STEPS_CONTRACT = defineContract({
    port: 'steps',
    side: 'host',
    cases: CASES,
    liars: [nothingSteps, yesSteps],
});
