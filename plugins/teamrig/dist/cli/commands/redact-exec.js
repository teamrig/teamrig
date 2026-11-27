import { constants } from 'node:os';
import { ENV } from "../../core/home.js";
import { secretGuardOf, secretPatternsOf } from "../../hooks/secret-guard.js";
import { redactedLine, redactorOf, rotationText, rotatorOf } from "../../hooks/secret-redact.js";
import { decodePrompt } from "../../open/prompt.js";
import { secretRulesOf } from "../../secret-guard/rules.js";
import { commandLine, unrunnableReason } from "../../test-run/shell.js";
import { noPositionals, UsageError } from "../args.js";
import { secretFilesOf } from "../host.js";
import { sessionRef, shellWordsOf } from "../inputs.js";
import {} from "../runtime.js";
import { guardLoadOf } from "./hook-guard-load.js";
import { fileRotations } from "./secret-rotation.js";
const SHELL_PROGRAMS = {
    cmd: 'cmd.exe',
    sh: 'sh',
    bash: 'bash',
    powershell: 'powershell.exe',
};
function writeOutput(runtime, text) {
    if (text === '') {
        return;
    }
    runtime.out.stdout(text.replace(/\r?\n$/, ''));
}
function exitCodeOf(end) {
    if (end.kind === 'exited') {
        return end.code;
    }
    const signals = constants.signals;
    const num = Object.hasOwn(signals, end.signal) ? signals[end.signal] : undefined;
    return num === undefined ? 128 + 15 : 128 + num;
}
function shellFlagOf(args) {
    const value = args.flags.get('shell');
    if (value === undefined) {
        return undefined;
    }
    if (!Object.hasOwn(SHELL_PROGRAMS, value)) {
        throw new UsageError(`--shell must be one of ${Object.keys(SHELL_PROGRAMS).join(', ')}`);
    }
    return SHELL_PROGRAMS[value];
}
function commandOf(args, platform, shell) {
    const encoded = args.flags.get('encoded-command');
    if (encoded === undefined) {
        if (shell !== undefined && args.rest.length > 1) {
            throw new UsageError('pass the command as one quoted word');
        }
        return commandLine(shellWordsOf(args, platform), platform);
    }
    if (args.rest.length > 0 || args.restMarker) {
        throw new UsageError('--encoded-command and -- <command ...> cannot go together');
    }
    const decoded = decodePrompt(encoded);
    if (decoded === undefined) {
        throw new UsageError('--encoded-command is not a valid base64url command');
    }
    const problem = unrunnableReason([decoded], platform);
    if (problem !== undefined) {
        throw new UsageError(problem);
    }
    return decoded;
}
function sessionOf(args, runtime) {
    const flag = args.flags.get('session');
    if (flag !== undefined) {
        return sessionRef('--session', flag);
    }
    const fromEnv = runtime.env[ENV.session]?.trim();
    return fromEnv === undefined || fromEnv === '' ? undefined : sessionRef(`$${ENV.session}`, fromEnv);
}
function rotationEventOf(runtime) {
    return {
        name: 'tool-end',
        hostName: undefined,
        session: undefined,
        cwd: runtime.cwd,
        transcript: undefined,
        title: undefined,
        helper: undefined,
        call: undefined,
        prompt: undefined,
        hostPrompt: false,
        lastReply: undefined,
        stopActive: false,
        source: undefined,
        reason: undefined,
        trigger: undefined,
        model: undefined,
        effort: undefined,
        permission: undefined,
        message: undefined,
        error: undefined,
    };
}
/**
 * `teamrig redact-exec [--session <id|name>] [--shell <cmd|sh|bash|powershell>] (--encoded-command <text> | -- <command ...>)`:
 * loads the team's secret-guard config first, runs the command, redacts secrets from its merged stdout/stderr, files
 * rotation tasks on a leak, and returns the command's own exit code (or `128 + signal`).
 */
export async function redactExec(args, runtime) {
    noPositionals(args);
    const shell = shellFlagOf(args);
    const command = commandOf(args, runtime.platform, shell);
    const session = sessionOf(args, runtime);
    const guard = await guardLoadOf(runtime.cwd, runtime);
    const result = await runtime.shell.run({ command, cwd: runtime.cwd, env: runtime.env, ...(shell === undefined ? {} : { shell }) });
    const config = secretGuardOf(guard?.load);
    if (!config.redact) {
        writeOutput(runtime, result.output);
        return exitCodeOf(result.end);
    }
    const rules = secretRulesOf(config, runtime.userHome, runtime.platform, secretFilesOf(runtime), secretPatternsOf(guard?.load));
    const redaction = redactorOf(rules).redact({ output: result.output });
    const printed = typeof redaction.response['output'] === 'string' ? redaction.response['output'] : result.output;
    writeOutput(runtime, printed);
    if (redaction.classes.length > 0) {
        const rotationRuntime = session === undefined ? runtime : { ...runtime, env: { ...runtime.env, [ENV.session]: session } };
        const rotations = await fileRotations(rotationRuntime, rotationEventOf(rotationRuntime), {
            tool: 'redact-exec',
            kinds: redaction.classes,
            accounts: redaction.accounts,
        });
        runtime.out.stderr(redactedLine(redaction, rotationText(rotatorOf(guard?.load), rotations)));
    }
    return exitCodeOf(result.end);
}
