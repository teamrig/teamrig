import { posix, win32 } from 'node:path';
import { KIT_NAME } from "../core/home.js";
import { planHooksSetup } from "./commands/setup-hooks.js";
import { listedUserHooksOf } from "./host.js";
import { pluginRootOf } from "./plugin-root.js";
import { RefusedError } from "./runtime.js";
const SOURCE = 'the hook drift check [hosts]';
/** The plugin folder this run's CLI belongs to, or undefined for a run from a source checkout, which plans nothing. */
function installedPluginRoot(runtime) {
    try {
        return pluginRootOf(runtime.self.script, runtime.platform === 'win32' ? win32 : posix, 'check');
    }
    catch (error) {
        if (error instanceof RefusedError) {
            return undefined;
        }
        throw error;
    }
}
/** Why `setup hooks` would change what the files hold: one line per file it would write or cannot plan, none when in step. */
function driftOf(plan) {
    const found = [];
    if (!plan.answer.ok) {
        found.push({ file: plan.target, why: `cannot be merged into (${plan.answer.problem})` });
    }
    else if (plan.answer.value.file !== undefined) {
        const { inserted, changed, removed } = plan.answer.value.counts;
        found.push({ file: plan.target, why: plan.existed ? `differs from this install's hooks (${inserted} missing, ${changed} changed, ${removed} stale)` : 'is missing' });
    }
    if (!plan.configs.ok) {
        found.push({ file: plan.configs.file, why: `cannot be edited (${plan.configs.problem})` });
    }
    else {
        for (const config of plan.configs.plans) {
            if (config.text !== undefined) {
                found.push({ file: config.file, why: `lacks ${config.setting}` });
            }
        }
    }
    return found;
}
async function hostDrift(runtime, listed, pluginRoot, team) {
    const heal = `${KIT_NAME} setup hooks --host ${listed.port.host} --yes`;
    const warn = (file, why) => ({
        key: `hook-drift ${listed.id} ${file}`,
        source: SOURCE,
        text: `HOOK-DRIFT ${file} ${why}, so ${listed.id} sessions may run without ${KIT_NAME}'s guards. Heal it with ${heal} (the owner's step: it writes the person's hooks file).`,
    });
    let plan;
    try {
        plan = await planHooksSetup(runtime, listed.port, pluginRoot, team);
    }
    catch (error) {
        if (error instanceof RefusedError) {
            return [warn(listed.port.file(runtime.userHome), `cannot be read (${error.message})`)];
        }
        throw error;
    }
    return driftOf(plan).map(({ file, why }) => warn(file, why));
}
/**
 * HOOK-DRIFT (T5829), for `check`: each host the team lists whose hooks live in a file of the person's (Codex CLI's
 * hooks.json and config files), where `setup hooks` would write anything today: a teamrig handler missing, changed or
 * stale, or a config setting the guards need gone. Planned afresh from the files at every check, so only a heal clears
 * it, never a record a session could edit. Skipped for a run from a source checkout, which has no installed plugin to
 * plan from, and for a host whose hooks folder is not on this machine. The person's hooks file is the owner's, no one
 * session's area, so the warning goes to the lead. Reads only.
 */
export async function hookDriftWarnings(runtime, hosts, team) {
    const pluginRoot = installedPluginRoot(runtime);
    if (pluginRoot === undefined) {
        return [];
    }
    const path = runtime.platform === 'win32' ? win32 : posix;
    const warnings = [];
    for (const listed of listedUserHooksOf(runtime, hosts)) {
        if ((await runtime.files.realPath(path.dirname(listed.port.file(runtime.userHome)))) === undefined) {
            continue;
        }
        warnings.push(...(await hostDrift(runtime, listed, pluginRoot, team)));
    }
    return warnings;
}
