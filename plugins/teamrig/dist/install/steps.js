import { errorMessage } from "../core/guards.js";
/**
 * The release the install check started from. A step for something teamrig needed before the check existed (Node.js,
 * git, the CLI, a team) carries it, so no update from it or a later release names that step as new.
 */
export const INSTALL_CHECK_BASELINE = { major: 0, minor: 504, patch: 0 };
/** Long enough for a slow disk or a PATH of many folders, short enough that a hung probe never stalls doctor. */
export const PROBE_TIMEOUT_MS = 2_000;
const TIMED_OUT = Symbol('timed out');
/** One probe run on its own: a throw or a run past the limit is `unknown`, so it never stops the other steps. */
async function probeOne(step, deps, limit) {
    try {
        const state = await Promise.race([step.probe(deps), limit.sleep(limit.timeoutMs).then(() => TIMED_OUT)]);
        return state === TIMED_OUT ? { kind: 'unknown', why: `the probe ran past ${limit.timeoutMs} ms` } : state;
    }
    catch (error) {
        return { kind: 'unknown', why: errorMessage(error) };
    }
}
/** Every step's probe, run side by side, each under `limit`; the results keep the steps' order. */
export async function checkInstall(steps, deps, limit) {
    return Promise.all(steps.map(async (step) => ({ id: step.id, title: step.title, state: await probeOne(step, deps, limit) })));
}
/** The results as lines for a person: a header with the counts, then one line per step with its detail and any fix. */
export function installLines(results) {
    const count = (kind) => results.filter((result) => result.state.kind === kind).length;
    const header = `INSTALL ${results.length} step(s): ${count('ok')} ok, ${count('missing')} missing, ${count('unknown')} unknown`;
    return [header, ...results.map(resultLine)];
}
function resultLine(result) {
    const { state } = result;
    switch (state.kind) {
        case 'ok':
            return `  OK ${result.id} (${result.title}): ${state.detail}`;
        case 'missing':
            return `  MISSING ${result.id} (${result.title}): ${state.detail}; fix: ${state.fix}`;
        case 'unknown':
            return `  UNKNOWN ${result.id} (${result.title}): ${state.why}`;
    }
}
