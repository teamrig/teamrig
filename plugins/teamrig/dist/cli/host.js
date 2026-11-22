import { isUnsupported, } from "../ports/host/index.js";
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
 * the host the run works in, each glob once. A file is a secret for what it holds, whatever host runs the session,
 * and a machine may hold the files of a host other than the running one: so the running host adds to the shipped
 * hosts' files and takes none away. It never refuses, as the guard answers on every host: one that tells none of
 * its folders adds none.
 */
export function secretFilesOf(runtime) {
    const seen = { env: runtime.env, platform: runtime.platform };
    const named = [...runtime.shippedHosts, runtime.host].flatMap((source) => {
        const { paths } = source(seen);
        return isUnsupported(paths) ? [] : paths.secretFiles();
    });
    const once = [...new Set(named)];
    return { secretFiles: () => once };
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
 * The session variables teamrig holds in this run: those of every host adapter it ships with, then the running
 * host's, each name once. A machine may run a host other than the one this run works in, and a variable says who a
 * run is whatever host set it: so the running host adds to the shipped hosts' names and takes none away. It never
 * refuses: a host that tells nothing of its sessions adds none.
 */
export function sessionVariablesOf(runtime) {
    const named = launchersOf(runtime).map((launcher) => launcher.variables);
    return {
        marks: [...new Set(named.flatMap((variables) => variables.marks))],
        identity: [...new Set(named.flatMap((variables) => variables.identity))],
    };
}
/** The session launchers of every host adapter teamrig ships with, then the running host's: those that tell of their sessions. */
function launchersOf(runtime) {
    const seen = { env: runtime.env, platform: runtime.platform };
    return [...runtime.shippedHosts, runtime.host].flatMap((source) => {
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
 * keeps the mark of that run whichever host set it, so it never runs as the person's own. `login` is the running
 * host's alone, as the session started is a session of that host and keeps no other host's login. It never refuses:
 * a host that tells nothing of its sessions adds no name.
 */
export function childEnvOf(runtime) {
    const launchers = launchersOf(runtime);
    const parked = launchers.flatMap(({ childEnv, variables }) => [...childEnv.parked, ...variables.marks]);
    const session = launchers.flatMap(({ childEnv, variables }) => [...childEnv.session, ...variables.marks, ...variables.identity, ...childEnv.parked]);
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
/** The host's own folder for the person of this run. A host whose folders teamrig does not know refuses, as `pathsOf` does. */
export function hostHomeOf(runtime) {
    return pathsOf(runtime).home(runtime.userHome);
}
/** The host's own folder for the person of this run, or undefined on a host whose folders teamrig does not know. */
export function hostHomeIfKnown(runtime) {
    return pathsIfKnown(runtime)?.home(runtime.userHome);
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
/** The run's host's name as people know it, from its launcher. A host with no launcher refuses with its own reason. */
export function hostNameOf(runtime) {
    const { launcher } = hostOf(runtime);
    if (isUnsupported(launcher)) {
        throw new RefusedError(launcher.notice);
    }
    return launcher.programName;
}
