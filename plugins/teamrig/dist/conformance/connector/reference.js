/** The writes of the tracker port, each one a reference tracker can be told to answer as done without doing it. */
export const TRACKER_WRITES = ['open', 'comment', 'editBody', 'close', 'addLabels', 'removeLabel', 'assign', 'unassign'];
const DONE = { kind: 'done' };
const REPO = 'acme/app';
/**
 * A tracker held in memory that does what the contract asks: what the kit's own spec runs the cases against. Its
 * options make it lie, so a spec can show which case catches which lie.
 */
export function referenceTracker(options = {}) {
    const lies = new Set(options.lies ?? []);
    const issues = new Map();
    const labels = new Set();
    const people = new Set();
    let last = 0;
    const add = (title, body, given = []) => {
        last += 1;
        issues.set(last, { title, body, state: 'open', reason: undefined, labels: [...given], assignees: [], comments: [] });
        return { repo: REPO, number: last };
    };
    const issueAt = (target) => {
        const held = target.repo === REPO ? issues.get(target.number) : undefined;
        if (held !== undefined || options.writesAnywhere !== true) {
            return held;
        }
        const made = { title: '', body: '', state: 'open', reason: undefined, labels: [], assignees: [], comments: [] };
        issues.set(target.number, made);
        return made;
    };
    /** Does `act` on the issue at `target`, or answers done without it for a write it lies about. */
    const write = (name, target, act) => {
        if (lies.has(name)) {
            return Promise.resolve(DONE);
        }
        const issue = issueAt(target);
        return Promise.resolve(issue === undefined ? { kind: 'failed', reason: `no issue at ${target.repo}#${String(target.number)}` } : act(issue));
    };
    const port = {
        open: (draft) => {
            if (lies.has('open')) {
                last += 1;
                return Promise.resolve({ kind: 'opened', target: { repo: draft.repo, number: last } });
            }
            if (draft.repo !== REPO) {
                return Promise.resolve({ kind: 'failed', reason: `no place ${draft.repo}` });
            }
            return Promise.resolve({ kind: 'opened', target: add(draft.title, draft.body, draft.labels) });
        },
        comment: (target, body) => write('comment', target, (issue) => {
            issue.comments.push(body);
            return DONE;
        }),
        editBody: (target, body) => write('editBody', target, (issue) => {
            issue.body = body;
            return DONE;
        }),
        close: (target, reason) => write('close', target, (issue) => {
            issue.state = 'closed';
            issue.reason = options.oneReason === true ? 'completed' : (reason ?? 'completed');
            return DONE;
        }),
        labelExists: (repo, label) => Promise.resolve(options.everyLabel === true || (repo === REPO && labels.has(label)) ? { kind: 'found' } : { kind: 'missing' }),
        addLabels: (target, given) => write('addLabels', target, (issue) => {
            issue.labels = [...new Set([...issue.labels, ...given])];
            return DONE;
        }),
        removeLabel: (target, label) => write('removeLabel', target, (issue) => {
            issue.labels = issue.labels.filter((each) => each !== label);
            return DONE;
        }),
        assign: (target, logins) => write('assign', target, (issue) => {
            const unknown = logins.filter((login) => !people.has(login));
            if (unknown.length > 0) {
                return { kind: 'failed', reason: `no person ${unknown.join(', ')}` };
            }
            issue.assignees = [...new Set([...issue.assignees, ...logins])];
            return DONE;
        }),
        unassign: (target, login) => write('unassign', target, (issue) => {
            issue.assignees = issue.assignees.filter((each) => each !== login);
            return DONE;
        }),
    };
    const world = {
        repo: REPO,
        fileByHand: (title, body) => add(title, body),
        makeLabel: (name) => {
            labels.add(name);
        },
        addPerson: (login) => {
            people.add(login);
        },
        issue: (target) => {
            const held = target.repo === REPO ? issues.get(target.number) : undefined;
            return held === undefined ? undefined : { ...held, labels: [...held.labels], assignees: [...held.assignees], comments: [...held.comments] };
        },
    };
    return { port, world };
}
/** A liar that answers every write as done and makes none. */
export function yesTracker() {
    return referenceTracker({ lies: TRACKER_WRITES, everyLabel: true });
}
/** A liar that claims every feature and can do nothing: each write fails, and no label is there. */
export function nothingTracker() {
    const failed = { kind: 'failed', reason: 'nothing here' };
    const fails = () => Promise.resolve(failed);
    return {
        world: referenceTracker().world,
        port: {
            open: () => Promise.resolve({ kind: 'failed', reason: 'nothing here' }),
            comment: fails,
            editBody: fails,
            close: fails,
            labelExists: () => Promise.resolve({ kind: 'missing' }),
            addLabels: fails,
            removeLabel: fails,
            assign: fails,
            unassign: fails,
        },
    };
}
