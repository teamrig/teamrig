import { parseIssueTarget } from "../issues/host.js";
import { isFullCommitSha } from "../register/approval.js";
import { kitCallOf } from "./route-kit.js";
export const LANDING_COMMANDS = ['pr approve', 'pr merge'];
const LANDING_FLAGS = ['session', 'head'];
const LANDING_SWITCHES = ['check'];
/** True when `words` land a pull request as the route allows, through this install's own teamrig. */
export async function matchesLanding(words, context) {
    const call = kitCallOf(words, context.cli);
    if (call === undefined || !LANDING_COMMANDS.includes(call.parsed.command)) {
        return false;
    }
    const { flags, switches, common, positionals } = call.parsed;
    const [target, ...more] = positionals;
    const head = flags.get('head');
    const shaped = common.size === 0 &&
        [...flags.keys()].every((name) => LANDING_FLAGS.includes(name)) &&
        [...switches].every((name) => LANDING_SWITCHES.includes(name)) &&
        target !== undefined &&
        more.length === 0 &&
        parseIssueTarget(target) !== undefined &&
        head !== undefined &&
        isFullCommitSha(head);
    if (!shaped) {
        return false;
    }
    const approvers = await context.approversOf(flags.get('session'));
    return approvers.length > 0 && context.ownClient(call.program);
}
