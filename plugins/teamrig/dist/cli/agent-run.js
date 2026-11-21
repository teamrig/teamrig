import { isUnsupported } from "../ports/host/index.js";
import { hostOf, sessionVariablesOf } from "./host.js";
import { RefusedError } from "./runtime.js";
/** Why a run is untold on a host whose launcher names no mark, which no adapter that loaded does. */
export const NO_MARK_NAMED = "its session launcher names no mark of an agent's run";
/**
 * Who started this run. A host sets its marks for its agent's tools, what they run and its hook commands, but not
 * for what the person starts: their own terminal, and the plugin's mod, which runs the pane's buttons and a typed
 * `/teamrig` line with the host's own environment. The marks of every host teamrig ships with count, whatever host
 * the run works in (`sessionVariablesOf`), and a set one rules the person's routes out. An unset one proves nothing
 * against a script that clears it, which the exec guard refuses on a tool call's own line; and where the running
 * host names no mark at all nothing tells the two apart, so the answer there is `untold` and what only the person
 * runs is refused.
 */
export function runBy(runtime) {
    const mark = sessionVariablesOf(runtime).marks.find((name) => {
        const set = runtime.env[name];
        return set !== undefined && set !== '';
    });
    if (mark !== undefined) {
        return { kind: 'agent', mark };
    }
    const { launcher } = hostOf(runtime);
    if (isUnsupported(launcher)) {
        return { kind: 'untold', notice: launcher.notice };
    }
    return launcher.variables.marks.length === 0 ? { kind: 'untold', notice: NO_MARK_NAMED } : { kind: 'person' };
}
/** Why `what`, which only the person runs, is refused on a host that tells no agent's run from theirs, and what mends it. */
export function untoldRefusal(what, notice) {
    return (`${what} is for the person alone, so it is refused on a host where an agent's run cannot be told from theirs (${notice}); ` +
        "the host's adapter must name a mark of an agent's run in its declaration's sessionVariables.marks and fill its session launcher port");
}
/**
 * Refuses `what`, which only the person runs, in any run but theirs: an agent's, by `refusal` worded with the mark
 * that says so, and one on a host that tells the two apart by nothing, with the host's reason.
 */
export function refuseUnlessPerson(runtime, what, refusal) {
    const by = runBy(runtime);
    if (by.kind === 'agent') {
        throw new RefusedError(refusal(by.mark));
    }
    if (by.kind === 'untold') {
        throw new RefusedError(untoldRefusal(what, by.notice));
    }
}
