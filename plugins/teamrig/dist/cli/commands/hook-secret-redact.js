import { secretGuardOf, secretPatternsOf } from "../../hooks/secret-guard.js";
import { redactableResultOf, redactedLine, redactorOf, rotationText, rotatorOf } from "../../hooks/secret-redact.js";
import { secretRulesOf } from "../../secret-guard/rules.js";
import { noPositionals } from "../args.js";
import { secretFilesOf } from "../host.js";
import { EXIT } from "../runtime.js";
import { guardLoadOf } from "./hook-guard-load.js";
import { readHookInput, writeReply } from "./hook-input.js";
import { fileRotations } from "./secret-rotation.js";
/**
 * PostToolUse on Bash, PowerShell, Read and Grep (T1369 R7): replaces each secret the tool's result holds before the
 * model and the transcript see it, by the write-time shapes, the team's own patterns and the value of a secret variable.
 * A helper's calls are redacted too. Each kind found gets a rotation task (R8, see `fileRotations`), named in the line
 * for the model. A broken config keeps the defaults; outside a team's projects, or with `secretGuard.redact` off, it
 * prints nothing.
 */
export async function secretRedact(args, runtime) {
    noPositionals(args);
    const { event } = await readHookInput(runtime);
    writeReply(runtime, 'tool-end', event === undefined ? undefined : await secretRedactReplyOf(runtime, event));
    return EXIT.ok;
}
/** The secret-redact hook's reply to this call, alone or in a `hook after` set: the redacted result and its line, or none. */
export async function secretRedactReplyOf(runtime, event) {
    const guard = await guardLoadOf(event.cwd, runtime);
    if (guard === undefined) {
        return undefined;
    }
    const config = secretGuardOf(guard.load);
    const result = redactableResultOf(event);
    if (!config.redact || result === undefined) {
        return undefined;
    }
    const rules = secretRulesOf(config, runtime.userHome, runtime.platform, secretFilesOf(runtime), secretPatternsOf(guard.load));
    const redaction = redactorOf(rules).redact(result.response);
    if (redaction.classes.length === 0) {
        return undefined;
    }
    const rotations = await fileRotations(runtime, event, { tool: result.tool, kinds: redaction.classes, accounts: redaction.accounts });
    return { toolOutput: redaction.response, context: redactedLine(redaction, rotationText(rotatorOf(guard.load), rotations)) };
}
