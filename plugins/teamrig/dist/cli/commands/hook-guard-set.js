import { errorMessage } from "../../core/guards.js";
import { combinedGuardReply } from "../../hooks/guard-set.js";
import { passRecordGuardReply } from "../../hooks/pass-record-guard.js";
import { EXIT } from "../runtime.js";
import { guardLoadOf } from "./hook-guard-load.js";
import { membersNamed } from "./hook-set-names.js";
import { dbWriteGuardReplyOf, execGuardReplyOf, installGuardReplyOf, packageGuardReplyOf, pushGuardReplyOf, secretGuardReplyOf, serviceRoleGuardReplyOf } from "./hook-guard-outputs.js";
import { readHookInput, writeReply } from "./hook-input.js";
import { pickerGuardReplyOf } from "./hook-picker-guard.js";
import { readonlyAllowReplyOf } from "./hook-readonly-allow.js";
import { routeAllowReplyOf } from "./hook-route-allow.js";
const guardMember = (reply) => ({ reply, onThrow: 'refuse' });
const passMember = (reply) => ({ reply, onThrow: 'pass' });
/**
 * The hooks a set may name, each with its reply and failure mode. guard-runner.ts `SET_GUARDS` names the same
 * (hook-guard-set.test.ts holds the two equal), since the runner may import nothing.
 */
export function setMembersOf(deps) {
    return new Map([
        ['push-guard', guardMember(pushGuardReplyOf)],
        ['package-guard', guardMember(packageGuardReplyOf)],
        ['secret-guard', guardMember(secretGuardReplyOf)],
        ['db-write-guard', guardMember(dbWriteGuardReplyOf)],
        ['exec-guard', guardMember(execGuardReplyOf)],
        ['pass-record-guard', guardMember((_runtime, _guard, event) => passRecordGuardReply(event))],
        ['install-guard', guardMember((runtime, _guard, event) => installGuardReplyOf(runtime, event))],
        ['service-role-guard', guardMember(serviceRoleGuardReplyOf)],
        ['picker-guard', passMember((runtime, _guard, event) => pickerGuardReplyOf(runtime, event))],
        ['readonly-allow', passMember((runtime, _guard, event) => readonlyAllowReplyOf(runtime, event))],
        ['route-allow', passMember((runtime, _guard, event) => routeAllowReplyOf(runtime, event, deps))],
    ]);
}
/**
 * One member's answer: what it replied, or why it could not, a throw caught so the other members still answer. A
 * `pass` member's throw is no answer.
 */
async function answerOf(name, member, runtime, guard, event) {
    try {
        return { guard: name, kind: 'replied', reply: await member.reply(runtime, guard, event) };
    }
    catch (error) {
        if (member.onThrow === 'pass') {
            return { guard: name, kind: 'replied', reply: undefined };
        }
        return { guard: name, kind: 'failed', cause: errorMessage(error).split(/\r?\n/u, 1)[0] ?? '' };
    }
}
/**
 * PreToolUse on the tools the named members watch: runs them on the one call and prints their combined reply. Outside
 * a team's projects, or for input that is no hook payload, it prints nothing, as each member's own hook does.
 */
export function guardSet(deps) {
    return guardSetOf(setMembersOf(deps));
}
/** The set over the given members, for a spec of a member's failure mode; `guardSet` gives it the shipped ones. */
export function guardSetOf(members) {
    return async (args, runtime) => {
        const named = membersNamed(args, members, 'guard');
        const { event } = await readHookInput(runtime);
        const guard = await guardLoadOf(event?.cwd, runtime);
        if (guard === undefined || event === undefined) {
            return EXIT.ok;
        }
        const answers = await Promise.all(named.map(([name, member]) => answerOf(name, member, runtime, guard, event)));
        writeReply(runtime, 'tool-start', combinedGuardReply(answers));
        return EXIT.ok;
    };
}
