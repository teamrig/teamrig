import { posix, win32 } from 'node:path';
import { KIT_NAME } from "../core/home.js";
import { isUnsupported, } from "../ports/host/index.js";
import { DEFAULT_HOST } from "../composition/adapters.js";
import { isEffortLevel } from "../config/types.js";
import { RefusedError } from "./runtime.js";
/**
 * The host ports of one run, built from the environment and platform that run sees: a command asks here, and words
 * a refusal for a port the host cannot fill.
 */
export function hostOf(runtime) {
    return runtime.host({ env: runtime.env, platform: runtime.platform });
}
/**
 * The hook bridge of one run, for a hook command. A host with no hooks calls none of them, so one run there is
 * refused with the host's own reason.
 */
export function hooksOf(runtime) {
    const { hooks } = hostOf(runtime);
    if (isUnsupported(hooks)) {
        throw new RefusedError(hooks.notice);
    }
    return hooks;
}
/**
 * The run's hook bridge, or undefined on a host that calls no hook: for a caller that goes on without hooks, such as
 * a note on what the hooks would show.
 */
export function hooksIfRun(runtime) {
    const { hooks } = hostOf(runtime);
    return isUnsupported(hooks) ? undefined : hooks;
}
/**
 * The run's transcript reader, or undefined on a host that keeps no transcript teamrig can read: for a caller that
 * goes on without what a transcript would tell, such as a hook that must never answer by a refusal.
 */
export function transcriptsIfKept(runtime) {
    const { transcripts } = hostOf(runtime);
    return isUnsupported(transcripts) ? undefined : transcripts;
}
/**
 * The run's transcript reader. A host that keeps no transcript teamrig can read refuses with its own reason: a
 * command ends on it, and a hook, which lets no error out, does nothing.
 */
export function transcriptsOf(runtime) {
    const { transcripts } = hostOf(runtime);
    if (isUnsupported(transcripts)) {
        throw new RefusedError(transcripts.notice);
    }
    return transcripts;
}
/**
 * The run's usage meter, or undefined on a host whose calls teamrig cannot price: for a caller that goes on with the
 * cost unknown, such as a hook that must never answer by a refusal.
 */
export function usageIfMetered(runtime) {
    const { usage } = hostOf(runtime);
    return isUnsupported(usage) ? undefined : usage;
}
/**
 * What tells a session's context size on this run, or undefined on a host that keeps no readable transcript or prices
 * no call: a caller then goes on with the size unknown.
 */
export function contextSourceIfTold(runtime) {
    const { transcripts, usage } = hostOf(runtime);
    return isUnsupported(transcripts) || isUnsupported(usage) ? undefined : { reader: transcripts, usage };
}
/** The run's status line. A host that draws none refuses with its own reason, as `transcriptsOf` does. */
export function statusLineOf(runtime) {
    const { statusLine } = hostOf(runtime);
    if (isUnsupported(statusLine)) {
        throw new RefusedError(statusLine.notice);
    }
    return statusLine;
}
/** The run's usage meter. A host whose calls teamrig cannot price refuses with its own reason, as `transcriptsOf` does. */
export function usageOf(runtime) {
    const { usage } = hostOf(runtime);
    if (isUnsupported(usage)) {
        throw new RefusedError(usage.notice);
    }
    return usage;
}
/**
 * Where the run's host keeps its files, or undefined on a host whose folders teamrig does not know: for a caller that
 * goes on without the host's own files, such as a hook that must never answer by a refusal.
 */
export function pathsIfKnown(runtime) {
    const { paths } = hostOf(runtime);
    return isUnsupported(paths) ? undefined : paths;
}
/**
 * Where the run's host keeps its files. A host whose folders teamrig does not know refuses with its own reason: for
 * a command whose whole work is in the host's own files, such as one that edits its settings.
 */
export function pathsOf(runtime) {
    const { paths } = hostOf(runtime);
    if (isUnsupported(paths)) {
        throw new RefusedError(paths.notice);
    }
    return paths;
}
/**
 * Who tells the secret guard the hosts' own secret files in this run: every host adapter teamrig ships with, then
 * the host the run works in, each glob once, its `namedFiles` too. A file is a secret for what it holds, whatever host runs the session,
 * and a machine may hold the files of a host other than the running one: so the running host adds to the shipped
 * hosts' files and takes none away. It never refuses, as the guard answers on every host: one that tells none of
 * its secret files adds none.
 */
export function secretFilesOf(runtime) {
    const seen = { env: runtime.env, platform: runtime.platform };
    const told = sourcesOf(runtime).flatMap((source) => {
        const { secrets } = source(seen);
        return isUnsupported(secrets) ? [] : [secrets];
    });
    const listed = [...new Set(told.flatMap((secrets) => secrets.secretFiles()))];
    const named = [...new Set(told.flatMap((secrets) => secrets.namedFiles?.() ?? []))];
    return { secretFiles: () => listed, namedFiles: () => named };
}
/** What a host telling nothing of its sessions tells a run: no part of who it is. */
const UNTOLD = { projectDir: undefined, startedAs: undefined, sessionKind: undefined, sessionId: undefined, forcedEffort: undefined };
/**
 * Who the run's host says this run is: the folder its session started in, how the host was started, the kind of
 * session and the host's id of it. It never refuses: on a host that tells nothing of its sessions each part is
 * untold, and a caller goes on as in a run no session started, by the working folder and what its own input says.
 */
export function identityOf(runtime) {
    const { launcher } = hostOf(runtime);
    return isUnsupported(launcher) ? UNTOLD : launcher.identity();
}
/**
 * The session variables teamrig holds in this run: those every host adapter it ships with declares, its session
 * launcher built or not, then those of the launchers that tell of their sessions, each name once. A machine may run a
 * host other than the one this run works in, and a variable says who a run is whatever host set it: so the running
 * host adds to the shipped hosts' names and takes none away. A shipped host's agent sets its marks before teamrig
 * starts its sessions, so its declared names count even while its launcher is not built. It never refuses: a host
 * that tells nothing of its sessions adds none.
 */
export function sessionVariablesOf(runtime) {
    const named = [...declaredOf(runtime), ...launchersOf(runtime).map((launcher) => launcher.variables)];
    return {
        marks: [...new Set(named.flatMap((variables) => variables.marks))],
        identity: [...new Set(named.flatMap((variables) => variables.identity))],
    };
}
/**
 * The running host's session launcher, for a command that starts or resumes a session: the session it starts is one
 * of the host the run works in, whatever other host's sessions the machine holds. A host that tells nothing of its
 * sessions refuses with its own reason, as `transcriptsOf` does.
 */
export function launcherOf(runtime) {
    const { launcher } = hostOf(runtime);
    if (isUnsupported(launcher)) {
        throw new RefusedError(launcher.notice);
    }
    return launcher;
}
/**
 * The running host's session launcher, or undefined on a host that tells nothing of its sessions: for a caller that
 * goes on without the host's program, such as a hook that must never answer by a refusal.
 */
export function launcherIfTold(runtime) {
    const { launcher } = hostOf(runtime);
    return isUnsupported(launcher) ? undefined : launcher;
}
/**
 * The id of the shipped host adapter this run works in, as `--host` takes it. The run's host is the very source
 * `chooseHost` picked from the shipped hosts (src/cli/host-choice.ts); one that is none of them is the process's own
 * host, which loads the default adapter (src/composition/host-ports.ts loadHostPorts).
 */
export function hostIdOf(runtime) {
    const chosen = Object.entries(runtime.shippedHosts).find(([, shipped]) => shipped.ports === runtime.host);
    return chosen === undefined ? DEFAULT_HOST : chosen[0];
}
/** The way to build the ports of every host adapter teamrig ships with, then the running host's. */
function sourcesOf(runtime) {
    return [...Object.values(runtime.shippedHosts).map((shipped) => shipped.ports), runtime.host];
}
/** The session variables every host adapter teamrig ships with declares, its session launcher built or not. */
function declaredOf(runtime) {
    return Object.values(runtime.shippedHosts).map((shipped) => shipped.sessionVariables);
}
/** The session launchers of every host adapter teamrig ships with, then the running host's: those that tell of their sessions. */
function launchersOf(runtime) {
    const seen = { env: runtime.env, platform: runtime.platform };
    return sourcesOf(runtime).flatMap((source) => {
        const { launcher } = source(seen);
        return isUnsupported(launcher) ? [] : [launcher];
    });
}
/**
 * What a program this run starts may inherit of a host's session variables, each name once, the shipped hosts' first.
 * `session`, what a new session or a dispatched step never inherits, joins every shipped host adapter's names with
 * the running host's: its session variables, the marks and identity variables it tells a run by, and what it parks.
 * A machine may run a host other than the one this run works in, and a child inheriting any host's variables would be
 * taken for that host's session. `parked` joins them the same way, with every mark: a step parked by an agent's run
 * keeps the mark of that run whichever host set it, so it never runs as the person's own. A shipped host's declared
 * variables count in both, its session launcher built or not, as `sessionVariablesOf` counts them. `login` is the
 * running host's alone, as the session started is a session of that host and keeps no other host's login. It never
 * refuses: a host that tells nothing of its sessions adds no name.
 */
export function childEnvOf(runtime) {
    const launchers = launchersOf(runtime);
    const declared = declaredOf(runtime);
    const parked = [...declared.flatMap(({ marks }) => marks), ...launchers.flatMap(({ childEnv, variables }) => [...childEnv.parked, ...variables.marks])];
    const session = [
        ...declared.flatMap(({ marks, identity }) => [...marks, ...identity]),
        ...launchers.flatMap(({ childEnv, variables }) => [...childEnv.session, ...variables.marks, ...variables.identity, ...childEnv.parked]),
    ];
    const { launcher: running } = hostOf(runtime);
    return {
        session: [...new Set(session)],
        parked: [...new Set(parked)],
        login: isUnsupported(running) ? [] : [...new Set(running.childEnv.login)],
    };
}
/**
 * Whether a running process is a session's own host program, as any host adapter teamrig ships with or the running
 * host tells it. A machine may run a host other than the one this run works in, and a session recorded on it still
 * runs whichever host's program it is: so the running host adds to what the shipped hosts know and takes none away.
 * It never refuses: a host that tells nothing of its sessions knows none, and with no host that does, no process is
 * a session's.
 */
export function sessionProcessCheckOf(runtime) {
    const launchers = launchersOf(runtime);
    return (process) => launchers.some((launcher) => launcher.isSessionProcess(process));
}
/**
 * The programs that start a session, each once, as any shipped host or the running host names it: a tab's shell runs
 * whichever host's program its session is, so the running host adds to the shipped ones and takes none away.
 */
export function hostProgramsOf(runtime) {
    return [...new Set(launchersOf(runtime).map((launcher) => launcher.program))];
}
/**
 * The readers of a session's command line, as any host adapter teamrig ships with or the running host reads it: the
 * same union as `sessionProcessCheckOf`, since a session on the machine runs whichever host's program it is. A host
 * that tells nothing of its sessions reads none, so with no host that does, no command line is a fork or a job's.
 */
export function sessionCommandLinesOf(runtime) {
    const launchers = launchersOf(runtime);
    return {
        isForkOf: (commandLine, session) => commandLine !== undefined && launchers.some((launcher) => launcher.isForkOf(commandLine, session)),
        backgroundJobSession: (lineage) => launchers.map((launcher) => launcher.backgroundJobSession(lineage)).find((session) => session !== undefined),
    };
}
/**
 * The person's own hooks file of the host named `name` (as `setup hooks --host` takes it), from every host adapter
 * teamrig ships with and the run's own host: a person sets up the hooks of a host other than the one this run works
 * in, as from one host for another. A name no host answers to refuses, naming those that do.
 */
export function userHooksOf(runtime, name) {
    const seen = { env: runtime.env, platform: runtime.platform };
    const offered = sourcesOf(runtime).flatMap((source) => {
        const { userHooks } = source(seen);
        return isUnsupported(userHooks) ? [] : [userHooks];
    });
    const found = offered.find((port) => port.host === name);
    if (found !== undefined) {
        return found;
    }
    const names = [...new Set(offered.map((port) => port.host))];
    const known = names.length === 0 ? 'no host teamrig runs on keeps one' : `the hosts that keep one: ${names.join(', ')}`;
    throw new RefusedError(`no host named ${name} keeps a hooks file of yours teamrig writes into (${known})`);
}
/**
 * The id of the shipped host adapter whose hooks file `setup hooks --host <name>` writes, as its lines name it in
 * `--host <id>` and a team's `hosts` lists it; undefined for a name only the running, unshipped host keeps.
 */
export function userHooksHostId(runtime, name) {
    const seen = { env: runtime.env, platform: runtime.platform };
    const found = Object.entries(runtime.shippedHosts).find(([, shipped]) => {
        const { userHooks } = shipped.ports(seen);
        return !isUnsupported(userHooks) && userHooks.host === name;
    });
    return found?.[0];
}
/**
 * Every host whose lines in the person's hooks file run the kit launcher, from every host adapter teamrig ships with
 * and the run's own host, once each by name: `kit uninstall` takes their lines out before the launcher goes.
 */
export function kitLauncherHooksOf(runtime) {
    const seen = { env: runtime.env, platform: runtime.platform };
    const byHost = new Map();
    for (const source of sourcesOf(runtime)) {
        const { userHooks } = source(seen);
        if (isUnsupported(userHooks) || userHooks.kitLauncher === undefined || byHost.has(userHooks.host)) {
            continue;
        }
        byHost.set(userHooks.host, { port: userHooks, lines: userHooks.kitLauncher });
    }
    return [...byHost.values()];
}
/**
 * The person's own skills folder of the host named `name` (as `setup skills --host` takes it), from every host adapter
 * teamrig ships with and the run's own host, as `userHooksOf` finds a hooks file. A name no host answers to refuses,
 * naming those that keep one; a host whose plugin loads teamrig's skills keeps none.
 */
export function pluginSkillsOf(runtime, name) {
    const seen = { env: runtime.env, platform: runtime.platform };
    const offered = sourcesOf(runtime).flatMap((source) => {
        const { pluginSkills } = source(seen);
        return isUnsupported(pluginSkills) ? [] : [pluginSkills];
    });
    const found = offered.find((port) => port.host === name);
    if (found !== undefined) {
        return found;
    }
    const names = [...new Set(offered.map((port) => port.host))];
    const known = names.length === 0 ? 'no host teamrig runs on keeps one' : `the hosts that keep one: ${names.join(', ')}`;
    throw new RefusedError(`no host named ${name} keeps a skills folder of yours teamrig copies its skills into (${known})`);
}
/**
 * The hooks files and config files teamrig writes into for the person of this run (`setup hooks`), from every host
 * adapter teamrig ships with and the run's own host, one place per folder: the install guard keeps a session from
 * rewriting them, since a host starts every guard from them. A host that keeps no hooks file of the person's adds none.
 */
export function hookFilePlacesOf(runtime) {
    const seen = { env: runtime.env, platform: runtime.platform };
    const paths = runtime.platform === 'win32' ? win32 : posix;
    const byFolder = new Map();
    for (const source of sourcesOf(runtime)) {
        const { userHooks } = source(seen);
        if (isUnsupported(userHooks)) {
            continue;
        }
        for (const file of [userHooks.file(runtime.userHome), ...userHooks.configLines.map((lines) => lines.file(runtime.userHome))]) {
            const folder = paths.dirname(file);
            const place = byFolder.get(folder) ?? { hosts: new Set(), entries: new Set() };
            place.hosts.add(userHooks.host);
            place.entries.add(paths.basename(file));
            byFolder.set(folder, place);
        }
    }
    return [...byFolder].map(([folder, { hosts, entries }]) => ({
        folder,
        entries: [...entries],
        what: `the hook files of ${[...hosts].join(', ')}`,
        writer: '`teamrig setup hooks` writes them',
    }));
}
/** The host's own folder for the person of this run. A host whose folders teamrig does not know refuses, as `pathsOf` does. */
export function hostHomeOf(runtime) {
    return pathsOf(runtime).home(runtime.userHome);
}
/** The host's own folder for the person of this run, or undefined on a host whose folders teamrig does not know. */
export function hostHomeIfKnown(runtime) {
    return pathsIfKnown(runtime)?.home(runtime.userHome);
}
/**
 * The folder of the person's session transcripts, one folder per project. A host whose folders teamrig does not know
 * refuses, as `pathsOf` does, and so does one whose transcripts folder it does not know.
 */
export function transcriptsFolderOf(runtime) {
    const folder = pathsOf(runtime).transcriptsFolder(runtime.userHome);
    if (folder === undefined) {
        throw new RefusedError(NO_TRANSCRIPTS_FOLDER);
    }
    return folder;
}
/** Why a command that reads the session transcripts cannot run on a host whose transcripts folder teamrig does not know. */
export const NO_TRANSCRIPTS_FOLDER = `${KIT_NAME} does not know where this host keeps its session transcripts, so it cannot read them`;
/**
 * The folder of the person's session transcripts, or undefined on a host whose folders teamrig does not know: for a
 * hook or check that must go on, reading such a run as one with no transcript.
 */
export function transcriptsFolderIfKnown(runtime) {
    return pathsIfKnown(runtime)?.transcriptsFolder(runtime.userHome);
}
/** The run's permission rules. A host that keeps none refuses with its own reason, as `transcriptsOf` does. */
export function permissionsOf(runtime) {
    const { permissions } = hostOf(runtime);
    if (isUnsupported(permissions)) {
        throw new RefusedError(permissions.notice);
    }
    return permissions;
}
/**
 * The run's permission rules, or undefined on a host that keeps none: for a check that goes on without them, such as
 * doctor's, which then has no rule to find missing.
 */
export function permissionsIfKept(runtime) {
    const { permissions } = hostOf(runtime);
    return isUnsupported(permissions) ? undefined : permissions;
}
/** The run's plugin store. A host that keeps none refuses with its own reason, as `transcriptsOf` does. */
export function pluginOf(runtime) {
    const { plugin } = hostOf(runtime);
    if (isUnsupported(plugin)) {
        throw new RefusedError(plugin.notice);
    }
    return plugin;
}
/**
 * The run's plugin store, or undefined on a host that keeps none: for a step that goes on without it, such as a
 * session's PATH, which then has no cache folder to leave out.
 */
export function pluginIfKept(runtime) {
    const { plugin } = hostOf(runtime);
    return isUnsupported(plugin) ? undefined : plugin;
}
/**
 * The run's host's models, or undefined on a host that knows none: for a check that goes on without them, such as the
 * model notices, which then have no step to name.
 */
export function modelsIfKnown(runtime) {
    const { models } = hostOf(runtime);
    return isUnsupported(models) ? undefined : models;
}
/**
 * The launch the lead takes for each key its `launch` entry leaves unset: the host's lead default, its effort only when
 * it is a level on teamrig's scale. None from a host that knows no models, so the lead then starts on the host's own.
 */
export function leadLaunchFrom(models) {
    if (models === undefined) {
        return {};
    }
    const { model, effort } = models.leadDefault;
    return isEffortLevel(effort) ? { model, effort } : { model };
}
/** The run's host's lead default (`leadLaunchFrom`). */
export function leadLaunchOf(runtime) {
    return leadLaunchFrom(modelsIfKnown(runtime));
}
/** What a launch takes from these models: the lead default and their check of a model name; any name without them. */
export function launchHostFrom(models) {
    return { leadDefault: leadLaunchFrom(models), modelProblem: models === undefined ? () => undefined : (model) => models.problemOf(model) };
}
/** What a launch takes from the run's host (`launchHostFrom`). */
export function launchHostOf(runtime) {
    return launchHostFrom(modelsIfKnown(runtime));
}
/**
 * Whether a PATH folder is a plugin install's `bin` folder in the run's host's cache, for a session's PATH to leave
 * out. A host that keeps no plugin store has none, so every folder stays.
 */
export function cacheBinOf(runtime) {
    const plugin = pluginIfKept(runtime);
    return plugin === undefined ? () => false : (folder) => plugin.isCacheBin(folder);
}
/** The steps the run's host's person types. A host that names none refuses with its own reason, as `transcriptsOf` does. */
export function stepsOf(runtime) {
    const { steps } = hostOf(runtime);
    if (isUnsupported(steps)) {
        throw new RefusedError(steps.notice);
    }
    return steps;
}
/**
 * The steps the run's host's person types, or undefined on a host that names none: for a caller that goes on without
 * a notice naming them, such as the idle pass, whose acts must not fail for a line it cannot word.
 */
export function stepsIfKnown(runtime) {
    const { steps } = hostOf(runtime);
    return isUnsupported(steps) ? undefined : steps;
}
/**
 * The run's host's name as people know it, or undefined on a host with no launcher: for a caller that goes on
 * without it, such as the status line, which never fails.
 */
export function hostNameIfKnown(runtime) {
    const { launcher } = hostOf(runtime);
    return isUnsupported(launcher) ? undefined : launcher.programName;
}
/**
 * Whether the run's host wakes its sessions through its own program, as Codex CLI does: such a host has no tab mod
 * running the wake check, and with it the team's idle pass, while its session sits idle (src/cli/host-wake.ts).
 */
export function wakesThroughProgram(runtime) {
    const { launcher } = hostOf(runtime);
    return !isUnsupported(launcher) && !isUnsupported(launcher.wake);
}
/** The run's host's name as people know it, from its launcher. A host with no launcher refuses with its own reason. */
export function hostNameOf(runtime) {
    const { launcher } = hostOf(runtime);
    if (isUnsupported(launcher)) {
        throw new RefusedError(launcher.notice);
    }
    return launcher.programName;
}
