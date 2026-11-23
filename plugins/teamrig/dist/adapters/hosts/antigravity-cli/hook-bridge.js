import { isRecord, isStringArray, recordField, stringField, } from "../../../plugin-api/index.js";
import { checkHookInput } from "./hook-input.js";
/** Antigravity's hook event names paired with teamrig's event names (built without type casts). */
const EVENT_PAIRS = [
    ['session-start', 'SessionStart'],
    ['prompt', 'PreInvocation'],
    ['tool-start', 'PreToolUse'],
    ['tool-end', 'PostToolUse'],
    ['stop', 'Stop'],
];
const REVERSE_HOST_NAMES = new Map(EVENT_PAIRS.map(([core, host]) => [host, core]));
function eventNameOf(hostName, error) {
    if (hostName === 'PostToolUse' && error !== undefined && error !== '') {
        return 'tool-failed';
    }
    return hostName === undefined ? 'other' : (REVERSE_HOST_NAMES.get(hostName) ?? 'other');
}
function sessionOf(payload) {
    const id = stringField(payload, 'conversationId')?.trim();
    return id === undefined || id === '' ? undefined : id;
}
function cwdOf(payload) {
    const cwd = stringField(payload, 'cwd')?.trim();
    if (cwd !== undefined && cwd !== '') {
        return cwd;
    }
    const workspaces = payload['workspacePaths'];
    return isStringArray(workspaces) && workspaces.length > 0 ? workspaces[0] : undefined;
}
function callOf(payload, shape) {
    const toolCall = recordField(payload, 'toolCall');
    if (toolCall === undefined) {
        return undefined;
    }
    const name = stringField(toolCall, 'name');
    if (name === undefined) {
        return undefined;
    }
    const id = stringField(toolCall, 'id');
    const args = recordField(toolCall, 'args') ?? {};
    return {
        ...shape.normalize(name, args),
        ...(id === undefined ? {} : { id }),
    };
}
function eventOf(payload, shape, hostName) {
    const error = stringField(payload, 'error');
    const name = eventNameOf(hostName, error);
    return {
        name,
        hostName,
        session: sessionOf(payload),
        cwd: cwdOf(payload),
        transcript: stringField(payload, 'transcriptPath'),
        title: undefined,
        helper: undefined,
        call: callOf(payload, shape),
        prompt: stringField(payload, 'lastUserInput'),
        lastReply: undefined,
        // `continuationActive` comes from Antigravity 2.0's hooks docs; antigravity-cli may omit it or send `fullyIdle`.
        stopActive: payload['continuationActive'] === true,
        source: undefined,
        reason: stringField(payload, 'terminationReason'),
        trigger: undefined,
        model: stringField(payload, 'modelName'),
        effort: undefined,
        message: undefined,
        error,
    };
}
function parsed(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
function systemStep(text, userMarkdown) {
    const metadata = userMarkdown === undefined ? undefined : { user_markdown: userMarkdown };
    return {
        systemMessage: {
            systemMessage: text,
            ...(metadata === undefined ? {} : { metadata }),
        },
    };
}
function injectStepsOf(reply) {
    const steps = [];
    if (reply.context !== undefined && reply.context !== '') {
        steps.push(systemStep(reply.context, reply.notice));
    }
    else if (reply.notice !== undefined && reply.notice !== '') {
        steps.push(systemStep('', reply.notice));
    }
    return steps;
}
function preToolReply(reply) {
    const { verdict } = reply;
    if (verdict === undefined) {
        return '';
    }
    const decision = verdict.kind === 'allow' ? 'allow' : 'deny';
    return JSON.stringify({
        decision,
        ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
    });
}
function invocationReply(reply) {
    const { verdict } = reply;
    if (verdict !== undefined && verdict.kind !== 'allow') {
        return JSON.stringify({
            injectSteps: [{ errorMessage: { userMessage: verdict.reason } }],
            terminationBehavior: 'terminate',
        });
    }
    const injectSteps = injectStepsOf(reply);
    return injectSteps.length === 0 ? '' : JSON.stringify({ injectSteps });
}
function sessionStartReply(reply) {
    const injectSteps = injectStepsOf(reply);
    return injectSteps.length === 0 ? '' : JSON.stringify({ injectSteps });
}
function stopReply(reply) {
    const { verdict } = reply;
    if (verdict === undefined || verdict.kind === 'allow') {
        return JSON.stringify({});
    }
    return JSON.stringify({
        decision: 'continue',
        reason: verdict.reason,
    });
}
function replyText(on, reply) {
    switch (on) {
        case 'tool-start':
            return preToolReply(reply);
        case 'tool-end':
        case 'tool-failed':
            return JSON.stringify({});
        case 'session-start':
            return sessionStartReply(reply);
        case 'prompt':
            return invocationReply(reply);
        case 'stop':
            return stopReply(reply);
        default:
            return '';
    }
}
/**
 * The hook port of Antigravity: reads Antigravity's camelCase hook payloads into {@link HookEvent} and serializes
 * {@link HookReply} into Antigravity's `hooks.json` stdout JSON contracts.
 *
 * agy's input does not name its event, so the hook's command line does (`--host-event`, written by the hooks file):
 * that event wins, and the input must then fit the shape agy's hooks page gives it, or the bridge reads no event, as
 * it does for text that is no JSON object, rather than act on a misread input. A line with no `--host-event` falls
 * back to a `hookEventName` field in the input, unchecked, until a live agy run shows whether any build sends one.
 */
export function hookBridge(shape) {
    return {
        parse: (raw, hostEvent) => {
            const value = parsed(raw);
            if (!isRecord(value)) {
                return undefined;
            }
            if (hostEvent === undefined) {
                return eventOf(value, shape, stringField(value, 'hookEventName'));
            }
            return checkHookInput(hostEvent, value).ok ? eventOf(value, shape, hostEvent) : undefined;
        },
        reply: replyText,
        // Unproven: assumes Antigravity lets the call through when a hook fails; verify on a live agy run.
        failureRule: 'passes',
        titleSwitch: undefined,
    };
}
