import type { TrackerReadsPort } from '../conformance/index.ts';
import type { Tracker } from '../plugin-api/index.ts';

/**
 * The reads a tracker's contract spec binds: its thread, and its search, which is a capability a tracker may lack.
 * A tracker with no search throws, so the spec of an adapter that claims `tracker.search` fails at its binding.
 */
export function readsPortOf(tracker: Tracker): TrackerReadsPort {
  const search = tracker.search;
  if (search === undefined) {
    throw new Error('the tracker has no search, so the tracker reads contract cannot hold it');
  }
  return { thread: (target) => tracker.thread(target), search };
}
