import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { loginCallProblem, loginCallsOf } from "../hooks/hand-step-login.js";
import { handStepKindOf } from "../register/hand-step.js";
import { UsageError } from "./args.js";
import { RefusedError } from "./runtime.js";
/**
 * The hand step file `typed` names (T2312, core rule 11), read from the caller's folder: its absolute path and its
 * bytes now. `flag` names the flag that typed it, for the usage error a blank path or one with a line break gets
 * (parseAuditPin reads such a pin back as bad, so the register line it wrote would be lost); a missing file is refused.
 */
async function handStepNow(runtime, flag, typed) {
    if (typed.trim() === '') {
        throw new UsageError(`--${flag} needs the hand step file's path`);
    }
    if (/[\r\n]/.test(typed)) {
        throw new UsageError(`--${flag} takes the hand step file's path on one line: a path with a line break is not pinned`);
    }
    const path = resolve(runtime.cwd, typed);
    const bytes = await runtime.fileBytes.read(path);
    if (bytes === undefined) {
        throw new RefusedError(`no file ${path}`);
    }
    return { path, bytes };
}
/** The pin of the hand step file `typed` names: its absolute path and the sha256 of its bytes now, as `set --run` matches it. */
export async function handStepPin(runtime, flag, typed) {
    const { path, bytes } = await handStepNow(runtime, flag, typed);
    return { path, sha256: sha256Of(bytes) };
}
/**
 * The pin `audit --file` writes for the hand step file `typed` names, hashed from the same bytes it scanned: a file of
 * a hand step kind that calls gh, or a git command reaching a remote, on the human's login is refused, naming each
 * call (T4896). A file of no hand step kind is left to the register's policy, which refuses it.
 */
export async function auditPin(runtime, typed) {
    const { path, bytes } = await handStepNow(runtime, 'file', typed);
    const kind = handStepKindOf(path);
    const problem = kind === undefined ? undefined : loginCallProblem(path, loginCallsOf(new TextDecoder().decode(bytes), kind, runtime.userHome));
    if (problem !== undefined) {
        throw new RefusedError(problem);
    }
    return { path, sha256: sha256Of(bytes) };
}
/** The sha256 of `bytes`, in lowercase hex as an audit pins it. */
function sha256Of(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
/** The sha256 of the file at `path` now; null when there is none. */
async function sha256Now(runtime, path) {
    const bytes = await runtime.fileBytes.read(path);
    return bytes === undefined ? null : sha256Of(bytes);
}
/**
 * What each hand step file the cards of `tasks` hand the owner hashes to now (T2312), read as handStepPin reads it,
 * each file once, so a card printed from it shows the run line only while the file still has its audit's sha256.
 */
export async function readRunFiles(runtime, tasks) {
    const paths = new Set([...tasks].flatMap((task) => {
        const run = task.card?.run;
        return run === undefined ? [] : [run];
    }));
    return new Map(await Promise.all([...paths].map(async (path) => [path, await sha256Now(runtime, path)])));
}
