import { join, posix, win32 } from 'node:path';
import { formatConfig, writeConfigWithBackup, writeTextWithBackup } from "../../config/load.js";
import { errorMessage } from "../../core/guards.js";
import { hookLauncher, hookLauncherProblem } from "../../kit/hook-launcher.js";
import { resolveKitHome } from "../../core/home.js";
import { noPositionals, requiredFlag } from "../args.js";
import { readUserSettings } from "../user-settings.js";
import { userHooksOf } from "../host.js";
import { pluginRootOf } from "../plugin-root.js";
import { EXIT, RefusedError } from "../runtime.js";
/**
 * `setup hooks --host <name> [--yes]`: puts teamrig's hooks into the person's own hooks file of a host that loads no
 * plugin's hooks (its adapter names the file), beside the person's own handlers, which stay. teamrig's earlier
 * handlers are replaced, so the same command rewrites lines an older release wrote. A host whose lines run the kit
 * launcher (`kitLauncher`, Codex) gets lines naming `<kit home>/bin/teamrig.mjs` and no version, so an update
 * leaves them as they are; the run is refused before any write until the kit home holds an intact current version and
 * its launcher. Without --yes it only counts what would be inserted, unchanged, changed and removed; with it, the old
 * file is kept in the kit's backups folder first. It never writes the host's trust in a handler: the person gives that
 * in the host, after every write. A setting the hooks need
 * in the host's own config file (the adapter's `configLines`, such as a host's interactive shells off) is set the
 * same way, every other line kept, the old file backed up; any file it cannot edit refuses the run before a write.
 * A set of config files the host layers over its main one (the adapter's `configFileSets`, such as Codex's
 * `<name>.config.toml` profiles) is edited file by file the same way; none is created.
 */
/** The plugin's own hooks file, below its root. */
const PLUGIN_HOOKS = ['hooks', 'hooks.json'];
/** A host config file's backup keeps its original's text whatever its format, so it takes no format's extension. */
const CONFIG_BACKUP_EXTENSION = '.bak';
/** `setup hooks --host <name> [--yes]`. */
export async function hooks(args, runtime) {
    noPositionals(args);
    const port = userHooksOf(runtime, requiredFlag(args.flags, 'host'));
    const path = runtime.platform === 'win32' ? win32 : posix;
    const pluginRoot = pluginRootOf(runtime.self.script, path, 'setup hooks');
    const source = await pluginHooks(runtime, path.join(pluginRoot, ...PLUGIN_HOOKS));
    const target = port.file(runtime.userHome);
    const current = await readUserSettings(runtime, target);
    const write = args.switches.has('yes');
    const kit = await launcherOf(runtime, port.kitLauncher !== undefined);
    if (write && kit.problem !== undefined) {
        throw new RefusedError(`${kit.problem}; nothing written`);
    }
    const answer = port.merge(current.json, source, pluginRoot, kit.launcher);
    if (!answer.ok) {
        throw new RefusedError(`${answer.problem}; nothing written`);
    }
    // Every file is checked before any is written, so a refusal leaves the hooks and the config as they were.
    const sets = await fileSetPlans(runtime, port.configFileSets ?? [], path);
    const configs = [...(await configPlans(runtime, port.configLines)), ...sets.plans];
    const { file, counts, skipped } = answer.value;
    const counted = `inserted ${counts.inserted}, unchanged ${counts.unchanged}, changed ${counts.changed}, removed ${counts.removed}`;
    if (file === undefined) {
        runtime.out.stdout(`UNCHANGED ${target}: teamrig's hooks are already in it (${counted})`);
    }
    else if (!write) {
        runtime.out.stdout(`PREVIEW nothing written (add --yes to write) ${target}: ${counted}`);
    }
    else {
        const backup = await written(runtime, target, current.exists, port.host, file);
        runtime.out.stdout(`WROTE ${target}: ${counted}${backup === undefined ? '' : `; the old file is at ${backup}`}`);
    }
    for (const config of configs) {
        runtime.out.stdout(await configWritten(runtime, config, port.host, write));
    }
    [...skipped, ...sets.skipped].forEach((line) => runtime.out.stdout(`  SKIPPED ${line}`));
    if (kit.problem !== undefined) {
        runtime.out.stdout(`  NOTE --yes is refused until the kit home can run these lines: ${kit.problem}`);
    }
    if (file !== undefined) {
        port.afterWrite.forEach((line) => runtime.out.stdout(`  NOTE ${line}`));
    }
    return EXIT.ok;
}
/**
 * The kit launcher a host's lines run, for a host whose lines run it; none for one whose lines name the plugin folder.
 * Its problem refuses a write while the kit home cannot run a line, as the launcher would block every guard event; a
 * preview still shows the lines, so an install that fills the kit home next (the install script previews first) can
 * show its whole plan.
 */
async function launcherOf(runtime, runsLauncher) {
    if (!runsLauncher) {
        return {};
    }
    const kitHome = resolveKitHome(runtime.env, runtime.userHome);
    const problem = await hookLauncherProblem(runtime.files, kitHome);
    const launcher = hookLauncher(kitHome);
    return problem === undefined ? { launcher } : { launcher, problem };
}
async function pluginHooks(runtime, file) {
    const text = await runtime.files.read(file);
    if (text === undefined) {
        throw new RefusedError(`the plugin's hooks file ${file} is missing; nothing written`);
    }
    try {
        const parsed = JSON.parse(text);
        return parsed;
    }
    catch (error) {
        throw new RefusedError(`the plugin's hooks file ${file} is not valid JSON (${errorMessage(error)}); nothing written`);
    }
}
const MAIN_CONFIG_LABEL = 'config';
async function configPlans(runtime, lines) {
    const plans = [];
    for (const config of lines) {
        const file = config.file(runtime.userHome);
        const current = await runtime.files.read(file);
        plans.push(configPlan(file, config.setting, current, config.merge(current ?? ''), MAIN_CONFIG_LABEL));
    }
    return plans;
}
function configPlan(file, setting, current, answer, backupLabel) {
    if (!answer.ok) {
        throw new RefusedError(`${file}: ${answer.problem}; nothing written`);
    }
    return { file, setting, existed: current !== undefined, text: answer.text, backupLabel };
}
async function fileSetPlans(runtime, sets, path) {
    const plans = [];
    const skipped = [];
    for (const set of sets) {
        const folder = set.folder(runtime.userHome);
        for (const name of (await runtime.files.list(folder)).filter((entry) => set.holds(entry)).toSorted()) {
            const file = path.join(folder, name);
            if (!(await runtime.files.isPlainFile(file))) {
                skipped.push(`${file}: not a plain file, so teamrig leaves it as it is; set ${set.setting} in it by hand`);
                continue;
            }
            const current = await runtime.files.read(file);
            if (current !== undefined)
                plans.push(configPlan(file, set.setting, current, set.merge(current), name));
        }
    }
    return { plans, skipped };
}
/** Writes one config file's setting with --yes (keeping the old file first), and says what it found or did. */
async function configWritten(runtime, plan, host, write) {
    if (plan.text === undefined) {
        return `UNCHANGED ${plan.file}: it already sets ${plan.setting}`;
    }
    if (!write) {
        return `PREVIEW nothing written (add --yes to write) ${plan.file}: sets ${plan.setting}`;
    }
    if (!plan.existed) {
        await runtime.files.write(plan.file, plan.text);
        return `WROTE ${plan.file}: sets ${plan.setting}`;
    }
    const backupsDir = join(resolveKitHome(runtime.env, runtime.userHome), 'backups');
    const backup = await writeTextWithBackup(runtime.files, { configPath: plan.file, backupsDir, backupName: `${host}-${plan.backupLabel}` }, plan.text, runtime.clock, CONFIG_BACKUP_EXTENSION);
    return `WROTE ${plan.file}: sets ${plan.setting}; the old file is at ${backup}`;
}
/** Writes the merged file, keeping the old one first when there was one; returns where it was kept. */
async function written(runtime, target, existed, host, file) {
    if (!existed) {
        await runtime.files.write(target, formatConfig(file));
        return undefined;
    }
    const backupsDir = join(resolveKitHome(runtime.env, runtime.userHome), 'backups');
    return writeConfigWithBackup(runtime.files, { configPath: target, backupsDir, backupName: `${host}-hooks` }, file, runtime.clock);
}
