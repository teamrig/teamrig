import { errorMessage } from '../core/guards.ts';
import type { Sleep } from '../core/lock.ts';
import type { Version } from '../core/release-version.ts';

/**
 * The install and update check (T5075): one ordered list of what a working teamrig needs, each step a live probe of
 * this machine with the fix for what it finds missing. No record of what setup ran is the truth: each run looks again,
 * so a step undone by hand (a PATH edit, a removed program) shows at once. `teamrig doctor` prints every step.
 */

/**
 * What a probe found:
 * - `ok`: the step is in place; `detail` names what was found, such as a version;
 * - `missing`: it is not, with `fix`, one line the person runs or does;
 * - `unknown`: the probe could not tell (it threw, or ran past its time), so neither a pass nor a fault.
 */
export type StepState =
  | { readonly kind: 'ok'; readonly detail: string }
  | { readonly kind: 'missing'; readonly detail: string; readonly fix: string }
  | { readonly kind: 'unknown'; readonly why: string };

/**
 * One install step: a stable id, a few words a person reads, the release that first needed it, and the probe that
 * looks at the machine through `D`. After an update, a step added in a release newer than the one updated from is new
 * to that person, so the update names it as new.
 */
export interface InstallStep<D> {
  readonly id: string;
  readonly title: string;
  readonly addedIn: Version;
  probe(deps: D): Promise<StepState>;
}

/**
 * The release the install check started from. A step for something teamrig needed before the check existed (Node.js,
 * git, the CLI, a team) carries it, so no update from it or a later release names that step as new.
 */
export const INSTALL_CHECK_BASELINE: Version = { major: 0, minor: 504, patch: 0 };

/** A step and what its probe found. */
export interface StepResult {
  readonly id: string;
  readonly title: string;
  readonly state: StepState;
}

/** How long each probe may run, and the wait that ends it: an unref'd timer in the CLI, so it never holds the process open. */
export interface ProbeLimit {
  readonly timeoutMs: number;
  readonly sleep: Sleep;
}

/** Long enough for a slow disk or a PATH of many folders, short enough that a hung probe never stalls doctor. */
export const PROBE_TIMEOUT_MS = 2_000;

const TIMED_OUT = Symbol('timed out');

/** One probe run on its own: a throw or a run past the limit is `unknown`, so it never stops the other steps. */
async function probeOne<D>(step: InstallStep<D>, deps: D, limit: ProbeLimit): Promise<StepState> {
  try {
    const state = await Promise.race([step.probe(deps), limit.sleep(limit.timeoutMs).then((): typeof TIMED_OUT => TIMED_OUT)]);
    return state === TIMED_OUT ? { kind: 'unknown', why: `the probe ran past ${limit.timeoutMs} ms` } : state;
  } catch (error) {
    return { kind: 'unknown', why: errorMessage(error) };
  }
}

/** Every step's probe, run side by side, each under `limit`; the results keep the steps' order. */
export async function checkInstall<D>(steps: readonly InstallStep<D>[], deps: D, limit: ProbeLimit): Promise<StepResult[]> {
  return Promise.all(steps.map(async (step) => ({ id: step.id, title: step.title, state: await probeOne(step, deps, limit) })));
}

/** The results as lines for a person: a header with the counts, then one line per step with its detail and any fix. */
export function installLines(results: readonly StepResult[]): string[] {
  const count = (kind: StepState['kind']): number => results.filter((result) => result.state.kind === kind).length;
  const header = `INSTALL ${results.length} step(s): ${count('ok')} ok, ${count('missing')} missing, ${count('unknown')} unknown`;
  return [header, ...results.map(resultLine)];
}

function resultLine(result: StepResult): string {
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
