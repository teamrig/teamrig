import { taskNumber } from "./fold.js";
/**
 * A team on its own whose numbers start at `first`: its numbers are its register's, which the register's own lock
 * hands out one at a time. A team that left a tree starts past every id the tree had issued (T5469).
 */
export function ownNumbersFrom(first) {
    return { issue: (write) => write(first) };
}
/** A team on its own that never left a tree: its numbers start at 1. */
export const OWN_NUMBERS = ownNumbersFrom(1);
/** A register's next number, read without its lock: reads never need it (store.ts). */
export class LogNumbers {
    log;
    constructor(log) {
        this.log = log;
    }
    async nextNumber() {
        return taskNumber((await this.log.read()).state.nextId);
    }
}
/**
 * One numbering across a team tree's registers. Every create in the tree runs under the tree's lock, so reading
 * the other registers' next numbers and appending the new task stay one step: two teams adding at once never
 * issue one number.
 */
export class TreeNumbering {
    mutex;
    others;
    first;
    /** `first` is the lowest number the tree issues: past every id of a tree one of its teams left (T5469). */
    constructor(mutex, others, first = 1) {
        this.mutex = mutex;
        this.others = others;
        this.first = first;
    }
    issue(write) {
        return this.mutex.run(async () => {
            const next = await Promise.all(this.others.map((other) => other.nextNumber()));
            return write(Math.max(this.first, ...next));
        });
    }
}
