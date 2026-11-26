import { ISSUE_LATER_REF_PREFIX, isIssueRef, LOCAL_REF_PREFIX } from "../register/model.js";
import { issueLabels, priorityLabelOf, publicIssueText } from "./migrate.js";
/** The name a refusal gives the task, which has no id before it is written. */
const NEW_TASK = 'the new task';
/** The plan for an add's issue under the team's GitHub settings, or why the add is refused. */
export function addIssuePlan(ask, github, scanner) {
    const asksIssue = ask.title !== undefined || ask.body !== undefined || ask.repo !== undefined;
    if (ask.local !== undefined && ask.later !== undefined) {
        return { ok: false, error: '--local keeps the task off GitHub and --issue-later opens its issue later; give one' };
    }
    if (ask.local !== undefined) {
        return reasonPlan(LOCAL, ask.local, asksIssue, ask.ref);
    }
    if (ask.later !== undefined) {
        return reasonPlan(LATER, ask.later, asksIssue, ask.ref);
    }
    if (asksIssue) {
        return openPlan(ask, github, scanner);
    }
    if (github.issueAtAdd !== undefined && !isIssueRef(ask.ref)) {
        return {
            ok: false,
            error: `github.issueAtAdd is ${github.issueAtAdd}: give the task's public issue with --issue <title> --issue-body <text>, ` +
                'why it stays local with --local <reason>, or why its issue opens later with --issue-later <reason>',
        };
    }
    return { ok: true, value: { kind: 'none' } };
}
const LOCAL = { kind: 'local', flag: '--local', prefix: LOCAL_REF_PREFIX, does: 'keeps the task off GitHub', says: 'why the task gets no issue' };
const LATER = {
    kind: 'later',
    flag: '--issue-later',
    prefix: ISSUE_LATER_REF_PREFIX,
    does: "leaves the task's issue to the holder of the issue migrate role",
    says: "why the task's issue opens later",
};
function reasonPlan(reasonFlag, reason, asksIssue, ref) {
    const { kind, flag, prefix, does, says } = reasonFlag;
    if (asksIssue) {
        return { ok: false, error: `${flag} ${does}, so it takes no --issue, --issue-body or --issue-repo` };
    }
    if (ref !== undefined) {
        return { ok: false, error: `${flag} writes the task's ref as the reason; give ${flag} or --ref, not both` };
    }
    const shown = reason.trim();
    if (shown === '' || /[\r\n]/u.test(shown)) {
        return { ok: false, error: `${flag} is one line saying ${says}` };
    }
    return { ok: true, value: { kind, ref: `${prefix}${shown}` } };
}
function openPlan(ask, github, scanner) {
    if (ask.title === undefined || ask.body === undefined) {
        return { ok: false, error: '--issue and --issue-body come together: the issue\'s public title and body' };
    }
    if (ask.ref !== undefined) {
        return { ok: false, error: '--issue points the task\'s ref at its new issue; give --issue or --ref, not both' };
    }
    const repo = repoOf(ask.repo, github);
    if (!repo.ok) {
        return repo;
    }
    const text = publicIssueText(NEW_TASK, ask.title, ask.body, scanner);
    if (!text.ok) {
        return text;
    }
    const labels = issueLabels(ask.type ?? 'task', priorityLabelOf(ask.priority));
    return { ok: true, value: { kind: 'open', draft: { repo: repo.value, ...text.value, labels } } };
}
/** `--issue-repo`, else `github.issueAtAdd`, else the one repository of `github.repos`. */
function repoOf(asked, { repos, issueAtAdd }) {
    if (repos.length === 0) {
        return { ok: false, error: 'github.repos names no repository to open the issue in' };
    }
    if (asked !== undefined) {
        const repo = asked.trim().toLowerCase();
        return repos.includes(repo) ? { ok: true, value: repo } : { ok: false, error: `--issue-repo ${asked} is not one of github.repos (${repos.join(', ')})` };
    }
    if (issueAtAdd !== undefined) {
        return { ok: true, value: issueAtAdd };
    }
    const [only, ...more] = repos;
    if (only === undefined || more.length > 0) {
        return { ok: false, error: `--issue-repo names the repository: github.repos has ${repos.length} (${repos.join(', ')}) and github.issueAtAdd names none` };
    }
    return { ok: true, value: only };
}
