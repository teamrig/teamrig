import { constants } from 'node:os';
import { ENV } from '../../core/home.ts';
import type { ShellEnd } from '../../core/shell-end.ts';
import { secretGuardOf, secretPatternsOf } from '../../hooks/secret-guard.ts';
import { redactedLine, redactorOf, rotationText, rotatorOf } from '../../hooks/secret-redact.ts';
import { decodePrompt } from '../../open/prompt.ts';
import type { HookEvent } from '../../ports/host/index.ts';
import { secretRulesOf } from '../../secret-guard/rules.ts';
import { commandLine, unrunnableReason } from '../../test-run/shell.ts';
import { noPositionals, UsageError, type ParsedArgs } from '../args.ts';
import { secretFilesOf } from '../host.ts';
import { sessionRef, shellWordsOf } from '../inputs.ts';
import { EXIT, type CliRuntime, type ExitCode } from '../runtime.ts';
import { guardLoadOf } from './hook-guard-load.ts';
import { fileRotations } from './secret-rotation.ts';

const SHELL_PROGRAMS: Readonly<Record<string, string>> = {
  cmd: 'cmd.exe',
  sh: 'sh',
  bash: 'bash',
  powershell: 'powershell.exe',
};

function writeOutput(runtime: Pick<CliRuntime, 'out'>, text: string): void {
  if (text === '') {
    return;
  }
  runtime.out.stdout(text.replace(/\r?\n$/, ''));
}

function exitCodeOf(end: ShellEnd): ExitCode {
  if (end.kind === 'exited') {
    return end.code;
  }
  const signals: Readonly<Record<string, number>> = constants.signals;
  const num = Object.hasOwn(signals, end.signal) ? signals[end.signal] : undefined;
  return num === undefined ? 128 + 15 : 128 + num;
}

function shellFlagOf(args: ParsedArgs): string | undefined {
  const value = args.flags.get('shell');
  if (value === undefined) {
    return undefined;
  }
  if (!Object.hasOwn(SHELL_PROGRAMS, value)) {
    throw new UsageError(`--shell must be one of ${Object.keys(SHELL_PROGRAMS).join(', ')}`);
  }
  return SHELL_PROGRAMS[value];
}

function commandOf(args: ParsedArgs, platform: NodeJS.Platform): string {
  const encoded = args.flags.get('encoded-command');
  if (encoded === undefined) {
    return commandLine(shellWordsOf(args, platform), platform);
  }
  if (args.rest.length > 0) {
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

function sessionOf(args: ParsedArgs, runtime: CliRuntime): string | undefined {
  const flag = args.flags.get('session');
  if (flag !== undefined) {
    return sessionRef('--session', flag);
  }
  const fromEnv = runtime.env[ENV.session]?.trim();
  return fromEnv === undefined || fromEnv === '' ? undefined : sessionRef(`$${ENV.session}`, fromEnv);
}

function rotationEventOf(runtime: CliRuntime): HookEvent {
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
    lastReply: undefined,
    stopActive: false,
    source: undefined,
    reason: undefined,
    trigger: undefined,
    model: undefined,
    effort: undefined,
    message: undefined,
    error: undefined,
  };
}

/**
 * `teamrig redact-exec [--session <id|name>] [--shell <cmd|sh|bash|powershell>] (--encoded-command <text> | -- <command ...>)`:
 * loads the team's secret-guard config first, runs the command, redacts secrets from its merged stdout/stderr, files
 * rotation tasks on a leak, and returns the command's own exit code (or `128 + signal`).
 */
export async function redactExec(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const command = commandOf(args, runtime.platform);
  const shell = shellFlagOf(args);
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
    const rotationRuntime: CliRuntime = session === undefined ? runtime : { ...runtime, env: { ...runtime.env, [ENV.session]: session } };
    const rotations = await fileRotations(rotationRuntime, rotationEventOf(rotationRuntime), {
      tool: 'redact-exec',
      kinds: redaction.classes,
      accounts: redaction.accounts,
    });
    runtime.out.stderr(redactedLine(redaction, rotationText(rotatorOf(guard?.load), rotations)));
  }
  return exitCodeOf(result.end);
}
