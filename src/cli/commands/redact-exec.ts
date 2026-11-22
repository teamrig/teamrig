import { secretGuardOf, secretPatternsOf } from '../../hooks/secret-guard.ts';
import { redactedLine, rotatorOf } from '../../hooks/secret-redact.ts';
import { EnvAssignments } from '../../secret-guard/env-assignments.ts';
import { ToolOutputRedactor } from '../../secret-guard/redactor.ts';
import { secretRulesOf } from '../../secret-guard/rules.ts';
import { commandLine } from '../../test-run/shell.ts';
import { noPositionals, type ParsedArgs } from '../args.ts';
import { secretFilesOf } from '../host.ts';
import { shellWordsOf } from '../inputs.ts';
import { EXIT, type CliRuntime, type ExitCode } from '../runtime.ts';
import { guardLoadOf } from './hook-guard-load.ts';

function writeOutput(runtime: Pick<CliRuntime, 'out'>, text: string): void {
  if (text === '') {
    return;
  }
  runtime.out.stdout(text.replace(/\r?\n$/, ''));
}

/**
 * `teamrig redact-exec -- <command ...>`: runs a shell command and redacts any secret shapes or secret-variable
 * assignments from its output before printing it, for hosts whose `PostToolUse` hook cannot rewrite tool output.
 */
export async function redactExec(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const words = shellWordsOf(args, runtime.platform);
  const command = commandLine(words, runtime.platform);
  const result = await runtime.shell.run({ command, cwd: runtime.cwd, env: runtime.env });
  const guard = await guardLoadOf(runtime.cwd, runtime);
  const config = secretGuardOf(guard?.load);
  if (!config.redact) {
    writeOutput(runtime, result.output);
    return result.end.kind === 'exited' && result.end.code === 0 ? EXIT.ok : EXIT.failed;
  }
  const rules = secretRulesOf(config, runtime.userHome, runtime.platform, secretFilesOf(runtime), secretPatternsOf(guard?.load));
  const redaction = new ToolOutputRedactor([rules.shapes, new EnvAssignments(rules.names)]).redact({ output: result.output });
  const printed = typeof redaction.response['output'] === 'string' ? redaction.response['output'] : result.output;
  writeOutput(runtime, printed);
  if (redaction.classes.length > 0) {
    runtime.out.stderr(redactedLine(redaction, `${rotatorOf(guard?.load)} rotates it.`));
  }
  return result.end.kind === 'exited' && result.end.code === 0 ? EXIT.ok : EXIT.failed;
}
