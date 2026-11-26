import { AreaMap } from '../../config/areas.ts';
import { LeadTree } from '../../config/lead-tree.ts';
import { splitAddress } from '../../core/address.ts';
import { intakePlan, intakeReplyTitle, type IntakeAsk } from '../../sync/intake.ts';
import { targetText, type IssueTarget } from '../../issues/host.ts';
import { reviewRoute } from '../../push-guard/review-gate.ts';
import { GENERIC_REVIEW_PATHS, reviewPathMatcher } from '../../push-guard/review-paths.ts';
import type { Task } from '../../register/fold.ts';
import { ACTIVE_STATUSES } from '../../register/model.ts';
import type { AddInput, Verdict } from '../../register/policy.ts';
import type { WriteResult } from '../../register/register.ts';
import { requiredFlag, type ParsedArgs } from '../args.ts';
import { callerOf, deadlineOf, goalsOf, priorityOf } from '../inputs.ts';
import { sessionIdOf } from '../kit.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';
import { hostsFor, targetOf } from './issue.ts';
import { report } from './register.ts';
import { openTeam, tellAssigned, type Team } from './register-team.ts';
import { askTeam, treeCallerOf } from './team-ask.ts';

/**
 * `issue intake <owner/name#n> --priority <p>` (T3187): takes an outside pull request in by asking each session that owns
 * an area it changes (`github.areaPaths`, owned through `github.areaOwners`) a best-fix and overlap review as a task, the
 * security reviewer one too when it changes a guarded path (a review gate entry of class security), all in parallel; then
 * adds the caller's own task to answer the author, which runs after every review task (its plan dependency), so the
 * reply waits for each verdict. It reads the pull request's changed paths once (one page of at most 100) and writes
 * nothing to GitHub. A pull request taken in already (a reply task not dropped) is refused. A refusal of the caller's own
 * register stops it, as it would refuse every task, the area asks coming first; an ask another team's register refuses
 * is named on stderr and the rest still go, exit 1.
 */
export async function issueIntake(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  const target = targetOf(args);
  const hosts = await hostsFor(args, runtime, target.repo, undefined);
  if (hosts === undefined) {
    return EXIT.ok;
  }
  const team = await openTeam(runtime, 'write');
  const caller = sessionIdOf(team.roster, callerOf(args.flags, runtime.env));
  const base = baseOf(args, runtime, team);
  const taken = await replyOf(team, target);
  if (taken !== undefined) {
    throw new RefusedError(`${targetText(target)} is taken in already: ${taken.id} answers its author once its reviews are in; drop ${taken.id} to take it in again`);
  }
  // A code host with no codehost.pull-files gives no paths: the plan asks every area owner and security instead.
  const read = hosts.codeHost.changedFiles;
  const files = read === undefined ? undefined : await read.pullFiles(target);
  if (files?.kind === 'failed') {
    runtime.out.stderr(`FAILED ${files.reason}`);
    return EXIT.failed;
  }
  const { config } = team;
  const guarded = [...GENERIC_REVIEW_PATHS, ...config.pushGuard.reviewPaths].filter((entry) => entry.class === 'security').map((entry) => reviewPathMatcher(entry.glob));
  const route = reviewRoute('security', caller, new LeadTree(config, team.above), config.roles);
  const plan = intakePlan({
    target,
    files,
    areas: new AreaMap(config.github),
    isSecurityPath: (path) => guarded.some((matches) => matches(path)),
    securityReviewer: route.kind === 'route' ? route.who : undefined,
    caller,
  });
  const asked: string[] = [];
  let failed = false;
  for (const ask of plan.asks) {
    try {
      asked.push(await askOf(runtime, team, caller, ask, base));
    } catch (error) {
      if (!(error instanceof RefusedError) || teamOf(ask, team) === undefined) {
        throw error;
      }
      failed = true;
      runtime.out.stderr(`FAILED asking ${ask.owner} the ${ask.kind} review: ${error.message}; ask it with teamrig add and list it in the reply task's after`);
    }
  }
  added(runtime, await team.register.add(caller, { ...base, ...plan.reply, owner: caller, source: caller, ...(asked.length === 0 ? {} : { after: asked }) }), team);
  return failed ? EXIT.failed : EXIT.ok;
}

/** What every task of the intake carries from the flags: its priority, goals and deadline. */
type IntakeFields = Pick<AddInput, 'priority' | 'due' | 'goals' | 'noGoal'>;

function baseOf(args: ParsedArgs, runtime: CliRuntime, team: Team): IntakeFields {
  const priority = requiredFlag(args.flags, 'priority');
  const due = args.flags.get('due');
  const goals = args.flags.get('goals');
  const said = goals === undefined ? undefined : goalsOf(goals);
  return {
    priority: priorityOf(priority),
    ...(due === undefined ? {} : { due: deadlineOf('--due', due, { nowMs: runtime.clock.now(), zone: team.zone }) }),
    ...(said === undefined ? {} : { goals: said.goals, ...(said.noGoal === undefined ? {} : { noGoal: said.noGoal }) }),
  };
}

/** The reply task an earlier intake of `target` added, while it is not dropped. */
async function replyOf(team: Team, target: IssueTarget): Promise<Task | undefined> {
  const title = intakeReplyTitle(target);
  const { state } = await team.register.snapshot();
  return [...state.tasks.values()].find((task) => task.title === title && task.status !== 'dropped');
}

/** The caller's register's active task titled `title`, which the register would refuse to add again. */
async function openAskOf(team: Team, title: string): Promise<Task | undefined> {
  const { state } = await team.register.snapshot();
  return [...state.tasks.values()].find((task) => task.title === title && ACTIVE_STATUSES.includes(task.status));
}

/**
 * Adds one review task, in the caller's register or, for a reviewer on another team of the tree, in that team's; its id.
 * A review of the caller's register still open from an earlier intake is kept, its KEPT line printed, and not added again.
 */
async function askOf(runtime: CliRuntime, team: Team, caller: string, ask: IntakeAsk, base: IntakeFields): Promise<string> {
  const input = { ...base, title: ask.title, description: ask.description };
  const other = teamOf(ask, team);
  // An intake again after its reply was dropped finds its own reviews still open: the new reply waits on them.
  const open = other === undefined ? await openAskOf(team, ask.title) : undefined;
  if (open !== undefined) {
    runtime.out.stdout(`KEPT ${open.id} ${open.status}, owner ${open.owner} | ${open.title}`);
    return open.id;
  }
  if (other !== undefined) {
    const { verdict, target } = await askTeam(runtime, await treeCallerOf(runtime, team.paths.team, caller, other.team), { asked: other.team, owner: other.session }, input);
    return added(runtime, verdict, target, other.team).id;
  }
  const verdict = await team.register.add(caller, { ...input, owner: sessionIdOf(team.roster, splitAddress(ask.owner)?.session ?? ask.owner), source: caller });
  const task = added(runtime, verdict, team);
  await tellAssigned(runtime, team, caller, task);
  return task.id;
}

/** The reviewer's team and session when it is on another team of the tree (`<team>/<id>`); undefined on the caller's own. */
function teamOf(ask: IntakeAsk, team: Team): { readonly team: string; readonly session: string } | undefined {
  const address = splitAddress(ask.owner);
  return address?.team === undefined || address.team === team.paths.team ? undefined : { team: address.team, session: address.session };
}

/** The task a write added, its ADDED line printed; a refused write throws its refusal. */
function added(runtime: CliRuntime, verdict: Verdict<WriteResult>, written: Team, label?: string): Task {
  if (!verdict.ok) {
    throw new RefusedError(verdict.error);
  }
  report(runtime, verdict, 'ADDED', written, label);
  return verdict.value.task;
}
