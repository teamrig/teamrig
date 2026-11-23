/** How an issue's assignees bring it into scope: `team`, one of the team's people; `none`, never (labels only). */
export const ASSIGNED_SCOPES = ['team', 'none'];
export function isAssignedScope(value) {
    return ASSIGNED_SCOPES.some((scope) => scope === value);
}
/** The scope a team gets with no setup: its people's issues and those labelled `teamrig`. */
export const DEFAULT_SCOPE = { all: false, assigned: 'team', labels: ['teamrig'] };
/** The caps a team gets with no setup. */
export const DEFAULT_CAPS = { maxOpen: 200, maxNewPerSync: 50 };
function lower(values) {
    return new Set(values.map((value) => value.toLowerCase()));
}
/** Whether `issue` is in `request`'s scope: a held one always is. */
export function inScope(issue, request) {
    if (request.scope.all || request.held.includes(issue.number)) {
        return true;
    }
    const labels = lower(request.scope.labels);
    if (issue.labels.some((label) => labels.has(label.toLowerCase()))) {
        return true;
    }
    if (request.scope.assigned === 'none') {
        return false;
    }
    const people = lower(request.people);
    return issue.assignees.some((login) => people.has(login.toLowerCase()));
}
/** The issues of `issues` in `request`'s scope (inScope), the tracker's order kept. */
export function scopeIssues(issues, request) {
    const kept = issues.filter((issue) => inScope(issue, request));
    return { issues: kept, outside: issues.length - kept.length };
}
/**
 * `plan` with its adds cut to `caps`, given the `open` tasks the import already holds: at most `maxNewPerSync` adds,
 * and none past `maxOpen` open tasks. Updates and status changes of held tasks are never cut. The adds kept are the
 * first by `order` (issues assigned to the team's people first, then the one changed longest ago), so a rerun keeps
 * the same ones and the next run takes the next.
 */
export function capPlan(plan, issues, refOf, request, caps, open) {
    const adds = plan.steps.filter((step) => step.kind === 'add');
    const room = Math.max(0, caps.maxOpen - open);
    const allowed = Math.min(caps.maxNewPerSync, room);
    if (adds.length <= allowed) {
        return { plan, held: 0, key: undefined };
    }
    const rank = addOrder(issues, refOf, request);
    const kept = new Set([...adds].sort((a, b) => rank(a) - rank(b)).slice(0, allowed));
    const steps = plan.steps.filter((step) => step.kind !== 'add' || kept.has(step));
    const held = adds.length - allowed;
    return {
        plan: { ...plan, steps, inserted: plan.inserted - held },
        held,
        key: room < caps.maxNewPerSync ? 'maxOpen' : 'maxNewPerSync',
    };
}
/** The rank of an add step: its issue's place in the order capPlan keeps adds by. */
function addOrder(issues, refOf, request) {
    const people = lower(request.people);
    const ordered = [...issues].sort((a, b) => {
        const assigned = Number(isAssigned(b, people)) - Number(isAssigned(a, people));
        return assigned !== 0 ? assigned : changedAt(a) - changedAt(b) || a.number - b.number;
    });
    const byRef = new Map();
    ordered.forEach((issue, index) => {
        const ref = refOf(issue);
        if (ref !== undefined && !byRef.has(ref)) {
            byRef.set(ref, index);
        }
    });
    return (step) => byRef.get(step.ref) ?? ordered.length;
}
function isAssigned(issue, people) {
    return issue.assignees.some((login) => people.has(login.toLowerCase()));
}
function changedAt(issue) {
    const at = issue.updatedAt === undefined ? Number.NaN : Date.parse(issue.updatedAt);
    return Number.isNaN(at) ? Number.MAX_SAFE_INTEGER : at;
}
