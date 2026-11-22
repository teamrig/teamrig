function isActive(task) {
    return task.status !== 'done' && task.status !== 'dropped';
}
/**
 * The ids an active task waits on (a `task` wait) when the waiting task's owner is not the named task's: work one
 * session holds up for another. A session's wait on its own task names its own order, not someone else's need. The
 * waiting task may sit in the register or in another register of the team tree (`elsewhere`).
 */
export function waitedOnByOthers(tasks, elsewhere) {
    const ownerOf = (id) => tasks.get(id)?.owner ?? elsewhere.get(id)?.task.owner;
    const waited = new Set();
    const waiters = [...tasks.values(), ...[...elsewhere.values()].map((other) => other.task)];
    for (const waiter of waiters.filter(isActive)) {
        for (const reason of waiter.waits) {
            if (reason.kind === 'task' && ownerOf(reason.id) !== waiter.owner) {
                waited.add(reason.id);
            }
        }
    }
    return waited;
}
/**
 * The exemption a session's rest leaves, up to `configured`: undefined unless the rest yields (held by the daily cap
 * or a plain cut, never a stop, a short day's pause or quiet hours), as only those holds give way to a waited-on task.
 */
export function restExemptionOf(rest, configured, tasks, elsewhere) {
    if (!rest.held || rest.yields !== true || rest.quiet) {
        return undefined;
    }
    let waited;
    return {
        upTo: configured,
        isExempt: (task) => {
            if (task.exempt !== null) {
                return true;
            }
            waited ??= waitedOnByOthers(tasks, elsewhere);
            return waited.has(task.id);
        },
    };
}
/** True when `exemption` lets `task` past a rest's priority cap. */
export function isExemptFromRest(task, exemption) {
    return exemption !== undefined && task.priority <= exemption.upTo && exemption.isExempt(task);
}
