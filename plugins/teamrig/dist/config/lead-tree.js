import { formatAddress } from "../core/address.js";
/**
 * The team's lead tree: `roles.lead` leads every other session on the team, as a group with a lead of its own is a
 * child team (T1140; config sub-leads went in T1320). On a child team, `above` is the parent team's lead, who approves
 * the lead's own work, as the lead approves its members'.
 */
export class LeadTree {
    lead;
    /** The parent team's lead as `<team>/<id>`, on a child team; undefined on a root team. */
    above;
    sessions;
    constructor(config, above) {
        this.lead = config.roles.lead;
        this.above = above === undefined ? undefined : formatAddress(above);
        this.sessions = config.sessions;
    }
    /** The session's leader on the team: the lead; undefined for the lead and for an id not on the team. */
    leaderOf(id) {
        return id === this.lead || !this.sessions.includes(id) ? undefined : this.lead;
    }
    /** The leaders above the session on the team: the lead, or none for the lead itself. */
    chainOf(id) {
        const leader = this.leaderOf(id);
        return leader === undefined ? [] : [leader];
    }
    /**
     * Whose decision or approval a session's task may wait on, besides the human owner: the lead; the lead's own task
     * waits on the parent team's lead on a child team, else on the lead.
     */
    approversOf(id) {
        const chain = this.chainOf(id);
        if (chain.length > 0) {
            return chain;
        }
        return id === this.lead && this.above !== undefined ? [this.above] : [this.lead];
    }
    /** The sessions the leader leads, in config order: every other session for the lead, none for anyone else. */
    membersOf(leader) {
        return this.sessions.filter((id) => this.leaderOf(id) === leader);
    }
    /** Whether the session leads anyone on the team: only the lead does. */
    isLeader(id) {
        return id === this.lead;
    }
    /** Whether `leader` leads `id` on the team. */
    leads(leader, id) {
        return this.leaderOf(id) === leader;
    }
}
