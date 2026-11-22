import { isRecord, stringField } from '../../../core/guards.ts';

/**
 * One CI run as `gh api repos/<owner>/<name>/actions/runs/<id>` prints it: where it is, how it ended once it has, the
 * workflow file it ran, the event that started it and which attempt it is.
 */
export interface RunState {
  readonly status: string;
  /** Null until the run ends. */
  readonly conclusion: string | null;
  /** The workflow file's name (`ci.yml`), its path's last part: one name in a repository's one workflow folder. */
  readonly workflow: string;
  readonly event: string;
  /** 1 for the first run, one more for each re-run. */
  readonly attempt: number;
}

/** A status, conclusion or event as GitHub words them (`in_progress`, `timed_out`): lower-case words, never free text. */
const STATE_WORD = /^[a-z_]{1,40}$/u;

/** A workflow file's path: path characters only, so it prints on one line with nothing a terminal reads. */
const WORKFLOW_PATH = /^[\w./@-]{1,200}$/u;

/** The endings a re-run may follow (T5063): a failed, cancelled or timed-out run. */
const RERUN_ENDINGS: ReadonlySet<string> = new Set(['failure', 'cancelled', 'timed_out']);

/**
 * The events whose runs may be re-run (T5077 C3). A re-run takes the workflow file at the run's own commit, so a
 * pull_request_target or workflow_run run, which holds secrets or a write token, would run a version since fixed.
 */
const RERUN_EVENTS: ReadonlySet<string> = new Set(['push', 'pull_request', 'merge_group', 'schedule']);

/** The first attempt refused (T5077 C4): a run is re-run at most twice, so a loop of re-runs cannot burn Actions minutes. */
const REFUSED_ATTEMPT = 3;

/** The run's state from gh's JSON, or undefined when it does not read as a run. */
export function runStateOf(stdout: string): RunState | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const status = stringField(parsed, 'status');
  const workflowPath = stringField(parsed, 'path');
  const workflow = workflowPath === undefined || !WORKFLOW_PATH.test(workflowPath) ? undefined : workflowPath.split('/').at(-1);
  const event = stringField(parsed, 'event');
  const attempt = parsed['run_attempt'];
  const conclusion = parsed['conclusion'];
  if (status === undefined || !STATE_WORD.test(status) || workflow === undefined || workflow === '' || event === undefined || !STATE_WORD.test(event)) {
    return undefined;
  }
  if (typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt < 1) {
    return undefined;
  }
  if (conclusion === null) {
    return { status, conclusion, workflow, event, attempt };
  }
  return typeof conclusion === 'string' && STATE_WORD.test(conclusion) ? { status, conclusion, workflow, event, attempt } : undefined;
}

/**
 * Why run `runId` of `repo` may not be re-run, or undefined when it may: only a run that ended failed, cancelled or
 * timed out, started by a push, pull request, merge queue or schedule, before its third attempt. A passed run is the
 * danger the first gate holds off: re-running a passed release run publishes the release again.
 */
export function rerunRefusal(repo: string, runId: number, state: RunState): string | undefined {
  const shown = `run ${String(runId)} of ${repo} (${state.workflow}, ${state.event}, attempt ${String(state.attempt)})`;
  if (state.status !== 'completed') {
    return `${shown} is ${state.status}, not ended: re-run it once it ends failed, cancelled or timed out; nothing was re-run`;
  }
  if (state.conclusion === null || !RERUN_ENDINGS.has(state.conclusion)) {
    return `${shown} ended ${state.conclusion ?? 'with no conclusion'}: only a failed, cancelled or timed-out run is re-run (a passed release run would publish again); nothing was re-run`;
  }
  if (!RERUN_EVENTS.has(state.event)) {
    return `${shown} was started by ${state.event}: only a push, pull_request, merge_group or schedule run is re-run (a re-run takes the run's old workflow file with its token); nothing was re-run`;
  }
  if (state.attempt >= REFUSED_ATTEMPT) {
    return `${shown} has run ${String(state.attempt)} times: a run is re-run at most twice; look at why it keeps failing; nothing was re-run`;
  }
  return undefined;
}
