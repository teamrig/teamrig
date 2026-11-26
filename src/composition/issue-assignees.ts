import type { KitConfig } from '../config/types.ts';
import { sessionLogins, type PushAssignees } from '../issues/status-push.ts';

/** Who the team's issues go to before the host is asked about any login: each session's login, and the design assignees. */
export type IssueAssignees = Pick<PushAssignees, 'logins' | 'design'>;

/**
 * The team's issue assignees, read from its tracker settings in one place, so the commands that assign issues (issue
 * push, the sync's push, issue migrate, issue reply) name no tracker of their own.
 */
export function issueAssigneesOf(config: Pick<KitConfig, 'github'>): IssueAssignees {
  return { logins: sessionLogins(config.github.owners), design: config.github.designAssignees };
}
