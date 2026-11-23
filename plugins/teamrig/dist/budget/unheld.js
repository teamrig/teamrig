import { roleHolderOf } from "../config/roster.js";
import { githubAnswerer } from "../sync/watcher.js";
/**
 * The sessions of `team` its budget never holds (T4388): the security reviewer, whose reviews gate other sessions'
 * work, and the GitHub answerer (sync/watcher.ts `githubAnswerer`), whose answers outside contributors wait on.
 * Past a daily budget, on a short day or under a cut they still work as if within their part; only a leader's
 * explicit stop (`teamrig budget --stop`) holds them, as it is a decision about that session, not a budget's pace.
 * A `<team>/<id>` reviewer is a team above's session, kept by that team's own budget.
 */
export function unheldOf(config, team) {
    const unheld = new Set();
    const reviewer = roleHolderOf(config.roles, 'securityReviewer', team);
    if (reviewer !== undefined && reviewer.team === team) {
        unheld.add(reviewer.id);
    }
    const answerer = githubAnswerer(config);
    if (answerer !== undefined) {
        unheld.add(answerer);
    }
    return unheld;
}
