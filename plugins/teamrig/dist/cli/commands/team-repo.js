import { SecretScanner } from "../../core/secrets.js";
import { hostKindOf } from "../../issues/host.js";
import { postRefusal } from "../../issues/write.js";
import { RegisterPolicy } from "../../register/policy.js";
import { CONNECTOR_OFF } from "../connector-off.js";
import { callerOf } from "../inputs.js";
import { hostsOf } from "../issue-hosts.js";
import { sessionIdOf } from "../kit.js";
import { RefusedError } from "../runtime.js";
import { githubOffBy } from "./issue-sync-auto.js";
import { openTeam } from "./register-team.js";
/**
 * The team, the caller and `repo`'s host kind once the caller is on the team and the repository is one of the team's:
 * the checks every `issue` and `pr` write to a host takes first (T2679, T4817).
 */
export async function checkedRepo(args, runtime, repo) {
    const team = await openTeam(runtime, 'read');
    const caller = sessionIdOf(team.roster, callerOf(args.flags, runtime.env));
    const notOnTeam = new RegisterPolicy(team.config, team.above).checkCaller(caller);
    if (notOnTeam !== undefined) {
        throw new RefusedError(notOnTeam);
    }
    const kind = hostKindOf(repo, team.config);
    if (kind === undefined) {
        const listed = team.config.github.repos.join(', ');
        throw new RefusedError(`${repo} is not one of the team's repositories: list it under github.repos in the team config${listed === '' ? '' : ` (now ${listed})`}`);
    }
    return { team, caller, config: team.config, kind };
}
/** The hosts of a checked repository once the text to post (if any) may be posted; undefined, after an OFF line, while GitHub is off. */
export async function hostsAfter(checked, runtime, posted) {
    const { config, kind } = checked;
    const scanner = new SecretScanner(config.register.secretPatterns);
    const refused = posted === undefined ? undefined : postRefusal(posted.flag, posted.text, scanner);
    if (refused !== undefined) {
        throw new RefusedError(refused);
    }
    const offBy = githubOffBy(runtime.env);
    if (offBy !== undefined) {
        runtime.out.stdout(`OFF ${offBy}=${CONNECTOR_OFF} turns GitHub off on this machine; nothing was written`);
        return undefined;
    }
    return hostsOf(kind, runtime, scanner, config.github.stamp, config.connectors);
}
