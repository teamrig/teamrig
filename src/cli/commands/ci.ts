import { onePositional, requiredFlag, type ParsedArgs } from '../args.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';
import { checkedRepo, hostsAfter } from './team-repo.ts';

/** A CI run's id as the host's address shows it (`.../actions/runs/<id>`): a positive whole number, never a flag. */
const RUN_ID = /^[1-9][0-9]{0,15}$/u;

/**
 * `ci rerun <owner/name> --run <id>` (T5063): starts the failed jobs of one CI run of one of the team's repositories
 * again, with the token saved for its owner, so a session can retry a run a glitch on the host's side failed (a job
 * reported passed while still running) with no person's click. The host reads the run first and re-runs only one
 * that ended failed, cancelled or timed out, started by a push, pull request, merge queue or schedule, before its third
 * attempt (T5077): a passed release run is never started again. It changes no code, setting or secret, so it takes
 * the checks every host write takes (the caller on the team, the repository in the team's repository list) and no task's approval.
 * Exit 2 when refused, 1 when the host failed, else 0, after an OFF line while the code host is off on this machine.
 */
export async function ciRerun(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  const repo = onePositional(args, 'owner/name').trim().toLowerCase();
  const given = requiredFlag(args.flags, 'run').trim();
  if (!RUN_ID.test(given)) {
    throw new RefusedError(`--run ${given} is no run id: give the number after /runs/ in the run's address; nothing was written`);
  }
  const runId = Number(given);
  const checked = await checkedRepo(args, runtime, repo);
  const hosts = await hostsAfter(checked, runtime, undefined);
  if (hosts === undefined) {
    return EXIT.ok;
  }
  const end = await hosts.codeHost.rerunRun(repo, runId);
  if (end.kind === 'refused') {
    throw new RefusedError(end.reason);
  }
  if (end.kind === 'failed') {
    runtime.out.stderr(`FAILED ${repo} run ${given}: ${end.reason}`);
    return EXIT.failed;
  }
  runtime.out.stdout(`RERUN ${repo} run ${given} (${end.workflow}, ${end.event}): its failed jobs started again as attempt ${String(end.attempt)}`);
  return EXIT.ok;
}
