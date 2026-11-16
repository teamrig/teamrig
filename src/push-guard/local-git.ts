import { onLocalDrive } from '../core/local-drive.ts';
import type { CommitLog, CommitRange } from './commit-size.ts';
import type { ConfigValue } from './invocations.ts';
import type { RepoState } from './push.ts';

/** A config value in a folder off this host's drives: unread, so the guard doubts what the value would have told it. */
const OFF_DRIVE_CONFIG: ConfigValue = { kind: 'unreadable' };

/**
 * `state` read only in a folder on this host's drives (T3339). The push guard reads git in the folder a line names
 * before anyone lets the line run; in a share or device folder git would connect to a host the line's text chose, as
 * the user. There every read is unknown, which the guard doubts, as it does a folder git cannot read.
 */
export function onLocalDrivesOnly(state: RepoState, onDrive: (path: string) => boolean = onLocalDrive): RepoState {
  return {
    branch: (dir) => (onDrive(dir) ? state.branch(dir) : undefined),
    head: (dir) => (onDrive(dir) ? state.head(dir) : undefined),
    pushTarget: (dir, branch) => (onDrive(dir) ? state.pushTarget(dir, branch) : undefined),
    config: (dir, key) => (onDrive(dir) ? state.config(dir, key) : OFF_DRIVE_CONFIG),
  };
}

/**
 * A range in a folder off this host's drives: `refused`, as when git cannot list it, never `unanswered`, which would
 * tell the user to run it again.
 */
const OFF_DRIVE_RANGE: CommitRange = { kind: 'refused' };

/** `log` read only in a folder on this host's drives, as {@link onLocalDrivesOnly}; elsewhere git cannot tell. */
export function commitLogOnLocalDrives(log: CommitLog, onDrive: (path: string) => boolean = onLocalDrive): CommitLog {
  return { between: (dir, base, tip) => (onDrive(dir) ? log.between(dir, base, tip) : OFF_DRIVE_RANGE) };
}
