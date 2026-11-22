import { parseIssueTarget, targetText } from "../../issues/host.js";
import { printable } from "../../core/printable.js";
import { holderOf } from "../../issues/status-push.js";
import { answerNamesFullHead, approvedTaskOf, isFullCommitSha } from "../../register/approval.js";
import { pullConflicts } from "../../sync/pull-conflicts.js";
import { onePositional, requiredFlag } from "../args.js";
import { EXIT, RefusedError } from "../runtime.js";
import { approversIn } from "../ship-approval.js";
import { checkedRepo, hostsAfter } from "./team-repo.js";
/** A commit id as the report prints it. */
const SHORT_SHA = 7;
/**
 * `pr conflicts <owner/name#n> [--base <branch>]` (T2693): in a clone of the pull request's repository, fetches the
 * pull request's head and prints the files it conflicts on against the newest base (default origin's default
 * branch), for the comment an outside author needs or the work a team pull request's owner must redo. It changes no local
 * branch or file of the clone and writes nothing to GitHub. Exit 0 with a CONFLICTS or CLEAN line, 1 when git
 * failed.
 */
export async function prConflicts(args, runtime) {
    const text = onePositional(args, 'pull request');
    const target = parseIssueTarget(text);
    if (target === undefined) {
        throw new RefusedError(`${text} names no pull request: give it as owner/name#number, such as acme/web#7`);
    }
    const say = (line) => runtime.out.stdout(line);
    const found = pullConflicts(runtime.pulls, runtime.cwd, target, args.flags.get('base'));
    const name = targetText(target);
    switch (found.kind) {
        case 'failed':
            runtime.out.stderr(`FAILED ${name}: ${found.reason}`);
            return EXIT.failed;
        case 'clean':
            say(`CLEAN ${name} (head ${found.headSha.slice(0, SHORT_SHA)}) merges into ${found.base} (${found.baseSha.slice(0, SHORT_SHA)}) with no conflict`);
            return EXIT.ok;
        case 'conflicts': {
            const count = found.files.length === 1 ? '1 file' : `${found.files.length} files`;
            say(`CONFLICTS ${name} (head ${found.headSha.slice(0, SHORT_SHA)}) against ${found.base} (${found.baseSha.slice(0, SHORT_SHA)}): ${count}`);
            // The file names are the pull request author's: escaped, a newline or ESC in one cannot forge a line or reach the terminal.
            for (const file of found.files) {
                say(`  ${printable(file)}`);
            }
            say(`To land it: rebase its branch onto ${found.base} and resolve these files.`);
            return EXIT.ok;
        }
    }
}
/**
 * `pr approve <owner/name#n> --head <sha> [--check]` (T4817): approves one pull request of the team's repositories at
 * its head, so the session holding its task can review an outside pull request on GitHub with no person's hand. It
 * writes only once every gate in clearedPull passes. `--check` prints what it would do and writes nothing. Exit 2
 * when refused, 1 when the host failed, else 0.
 */
export async function prApprove(args, runtime) {
    return land(args, runtime, 'approve');
}
/**
 * `pr merge <owner/name#n> --head <sha> [--check]` (T4817): lands one pull request of the team's repositories, through
 * its repository's merge queue when it has one, else merged by rebase, both pinned to the head read, so GitHub
 * refuses it if the head moved. The same gates as `pr approve`, plus no conflicts, not queued already and the head's
 * checks all passed: an admin token may bypass the branch's own required checks, so this gate does not leave them to
 * GitHub (T4958 C3). Exit 2 when refused, 1 when the host failed, else 0.
 */
export async function prMerge(args, runtime) {
    return land(args, runtime, 'merge');
}
async function land(args, runtime, step) {
    const say = (line) => runtime.out.stdout(line);
    const cleared = await clearedPull(args, runtime, step);
    if (cleared.kind === 'ended') {
        return cleared.code;
    }
    const { target, hosts, pull } = cleared;
    const name = targetText(target);
    const head = pull.head.slice(0, SHORT_SHA);
    if (args.switches.has('check')) {
        const would = step === 'approve' ? 'approve' : pull.mergeQueue ? 'add to the merge queue' : 'merge by rebase';
        say(`CHECK ${name} at ${head}: every gate passes, so pr ${step} would ${would} it; nothing was written`);
        return EXIT.ok;
    }
    if (step === 'approve') {
        const end = await hosts.codeHost.approvePull(target, pull.head);
        if (end.kind === 'failed') {
            runtime.out.stderr(`FAILED ${name}: ${end.reason}`);
            return EXIT.failed;
        }
        say(`APPROVED ${name} at ${head}`);
        return EXIT.ok;
    }
    const landed = await hosts.codeHost.landPull(target, pull);
    if (landed.kind === 'failed') {
        runtime.out.stderr(`FAILED ${name}: ${landed.reason}`);
        return EXIT.failed;
    }
    say(landed.kind === 'enqueued' ? `ENQUEUED ${name} at ${head}: it lands once the merge queue's checks pass` : `MERGED ${name} at ${head}`);
    return EXIT.ok;
}
/**
 * The pull request `args` names once every gate of a landing passes, reads before any write: the caller on the team
 * and the repository the team's; one task holding the pull request, owned by the caller (only a change's owner lands
 * it); that task approved by the caller's leader with a note naming the full 40-hex head (an approval covers only the head it
 * names, T2788), which a root team's lead needs from no one; and the pull request open, no draft, on its default
 * branch, its head the one `--head` names. A merge also needs no conflicts, not queued already and its head's checks
 * passed (pending, failing or none is refused). Ended with exit 0,
 * after an OFF line, while GitHub is off on this machine, and with exit 1 when the read failed. Refused or failed, it
 * writes nothing.
 */
async function clearedPull(args, runtime, step) {
    const text = onePositional(args, 'pull request');
    const target = parseIssueTarget(text);
    if (target === undefined) {
        throw new RefusedError(`${text} names no pull request: give it as owner/name#number, such as acme/web#7`);
    }
    const given = requiredFlag(args.flags, 'head').trim().toLowerCase();
    if (!isFullCommitSha(given)) {
        throw new RefusedError(`--head ${given} is no full commit sha: give the head the approval names, all 40 hex digits`);
    }
    const name = targetText(target);
    const checked = await checkedRepo(args, runtime, target.repo);
    const task = ownTask(target, (await checked.team.register.snapshot()).state.tasks.values(), checked.caller);
    const approvers = approversIn(checked.team.paths.team, checked.config, checked.caller, checked.team.above);
    if (approvers.length > 0 && approvedTaskOf([task], checked.caller, approvers) === undefined) {
        throw new RefusedError(`${task.id} has no approval of ${approvers.join(' or ')}: set it waiting approval:${approvers[0] ?? ''} with a note naming the head ${given}; nothing was written`);
    }
    const hosts = await hostsAfter(checked, runtime, undefined);
    if (hosts === undefined) {
        return { kind: 'ended', code: EXIT.ok };
    }
    const read = await hosts.codeHost.pullStand(target);
    if (read.kind === 'failed') {
        runtime.out.stderr(`FAILED ${name}: ${read.reason}; nothing was written`);
        return { kind: 'ended', code: EXIT.failed };
    }
    if (read.kind === 'missing') {
        throw new RefusedError(`${target.repo} has no pull request #${target.number} this access can see; nothing was written`);
    }
    const refused = standRefusal(read.pull, given, step) ?? (approvers.length > 0 && !answerNamesFullHead(task, read.pull.head) ? `the approval of ${task.id} does not name its head ${read.pull.head} in full: ask for an approval naming all 40 hex digits of that head` : undefined);
    if (refused !== undefined) {
        throw new RefusedError(`${name}: ${refused}; nothing was written`);
    }
    return { kind: 'cleared', target, hosts, pull: read.pull };
}
/** The one task holding `target`, refused when none or several do, or when it is another session's. */
function ownTask(target, tasks, caller) {
    const name = targetText(target);
    const holder = holderOf(target, tasks);
    if (holder === undefined) {
        throw new RefusedError(`no task holds ${name}: add the task with --ref gh:${target.repo}#${target.number}, set it waiting on your leader's approval naming the head; nothing was written`);
    }
    if (holder.kind === 'shared') {
        throw new RefusedError(`${holder.tasks.join(', ')} all hold ${name}, so no one task's approval speaks for it: finish or drop all but one; nothing was written`);
    }
    if (holder.task.owner !== caller) {
        throw new RefusedError(`${holder.task.id}, which holds ${name}, is ${holder.task.owner}'s: only the session that owns a change lands it; nothing was written`);
    }
    return holder.task;
}
/** Why the pull request as read may not take `step` at `given`, or undefined when it may. */
function standRefusal(pull, given, step) {
    if (pull.state !== 'open') {
        return `it is ${pull.state}`;
    }
    if (pull.draft) {
        return 'it is a draft';
    }
    if (pull.head !== given) {
        return `its head is ${pull.head.slice(0, SHORT_SHA)}, not ${given}: a newer head needs its own approval`;
    }
    if (pull.base !== pull.defaultBranch) {
        return `it targets ${pull.base}, not the default branch ${pull.defaultBranch}`;
    }
    if (step === 'merge' && pull.conflicts) {
        return `it conflicts with ${pull.base}: its author rebases it first`;
    }
    if (step === 'merge' && pull.queued) {
        return 'it is already in the merge queue';
    }
    if (step === 'merge' && pull.checks !== 'passing') {
        return pull.checks === 'none' ? 'its head has no checks: a merge needs them run and passed' : `its head's checks are ${pull.checks}: a merge needs them all passed`;
    }
    return undefined;
}
