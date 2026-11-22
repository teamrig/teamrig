import type { Task } from '../register/fold.ts';
import type { TasksElsewhere } from '../register/tree.ts';
import type { WakeRest } from './decide.ts';

/**
 * The work a held session still takes up to `upTo` (its configured wake priority), past the p0 cap its rest sets:
 * a task another session's task waits on, since a waited-on answer is never budget-held (rule 8, T4948), or one a
 * leader marked exempt (`update --exempt`). Only a rest that yields gives one ({@link restExemptionOf}).
 */
export interface RestExemption {
  readonly upTo: number;
  isExempt(task: Task): boolean;
}

function isActive(task: Task): boolean {
  return task.status !== 'done' && task.status !== 'dropped';
}

/**
 * The ids an active task waits on (a `task` wait) when the waiting task's owner is not the named task's: work one
 * session holds up for another. A session's wait on its own task names its own order, not someone else's need. The
 * waiting task may sit in the register or in another register of the team tree (`elsewhere`).
 */
export function waitedOnByOthers(tasks: ReadonlyMap<string, Task>, elsewhere: TasksElsewhere): ReadonlySet<string> {
  const ownerOf = (id: string): string | undefined => tasks.get(id)?.owner ?? elsewhere.get(id)?.task.owner;
  const waited = new Set<string>();
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
export function restExemptionOf(rest: WakeRest, configured: number, tasks: ReadonlyMap<string, Task>, elsewhere: TasksElsewhere): RestExemption | undefined {
  if (!rest.held || rest.yields !== true || rest.quiet) {
    return undefined;
  }
  let waited: ReadonlySet<string> | undefined;
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
export function isExemptFromRest(task: Task, exemption: RestExemption | undefined): boolean {
  return exemption !== undefined && task.priority <= exemption.upTo && exemption.isExempt(task);
}
