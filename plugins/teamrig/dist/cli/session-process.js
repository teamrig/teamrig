import { runsSession, sessionProcessOf } from "../open/session-processes.js";
import { sessionProcessCheckOf } from "./host.js";
/**
 * Whether `pid` still runs a session, in the program of a host teamrig ships with or of the running host
 * (`sessionProcessCheckOf`): a pid the system gave another program since does not count, nor one that is gone.
 */
export function runsHostSession(runtime, pid) {
    return runsSession(runtime.sessionProcesses, pid, sessionProcessCheckOf(runtime));
}
/**
 * The session this run works under: the host program that started it, itself or through a shell between
 * (`sessionProcessOf`), as a hook is started by its session. The program is one of a host teamrig ships with or of
 * the running host; undefined when none is that near, or the system would not list its processes.
 */
export function hostSessionAbove(runtime) {
    return sessionProcessOf(runtime.sessionProcesses, runtime.sessionProcesses.parentPid, sessionProcessCheckOf(runtime));
}
