import { toJsonlLine } from '../../core/jsonl.ts';
import { SecretScanner } from '../../core/secrets.ts';
import { hookAsksOf } from '../../hooks/permission.ts';
import { promptAnswerOf, promptAnswerRecord, promptAnswerReply, refusedCall } from '../../hooks/prompt-refuse.ts';
import { callReads } from '../../hooks/readonly-shell.ts';
import { allowRulesOf } from '../../permissions/allow-sync.ts';
import { routeHintOf } from '../../permissions/route-hint.ts';
import type { HookEvent, HookReply, ToolCall } from '../../ports/host/index.ts';
import type { CommandTable } from '../../slash/plan.ts';
import { noPositionals, type ParsedArgs } from '../args.ts';
import { hookLogOf } from '../hook-logs.ts';
import { permissionsIfKept } from '../host.ts';
import { openKit } from '../kit.ts';
import { EXIT, type CliRuntime, type ExitCode } from '../runtime.ts';
import { envSession, readHookInput, sessionTeam, writeReply } from './hook-input.ts';
import { readonlyCheckOf } from './hook-readonly-allow.ts';
import { callRouteOf } from './hook-route-context.ts';

/**
 * What `hook prompt-refuse` takes from the CLI: its command table, which reads a route's line, given so this module
 * never imports run.ts back.
 */
export interface PromptRefuseDeps {
  readonly table: CommandTable;
}

/**
 * What a refusal says of a bash line running one of teamrig's own commands (permissions/route-hint.ts): the route's
 * form or the synced allow rule. The rules come from the run's host; a host that keeps none gets no hint, since
 * `permissionsOf` would throw and a throw turns the answer into an open prompt. Route lines are read as bash words,
 * so no other dialect gets one.
 */
function hintOf(runtime: CliRuntime, call: ToolCall, table: CommandTable): (line: string) => string | undefined {
  if (call.kind !== 'shell' || call.dialect !== 'bash') {
    return () => undefined;
  }
  return (line) => {
    const permissions = permissionsIfKept(runtime);
    return permissions === undefined ? undefined : routeHintOf(line, table, (command) => allowRulesOf(permissions, [command]));
  };
}

/**
 * The hook's reply to this event: the answer for its case (an allow for a sanctioned route or a read-only line, else a
 * refusal with its reason), or none when the prompt opens. Each answer is logged to the team's prompt answers.
 */
async function promptRefuseReplyOf(runtime: CliRuntime, event: HookEvent, deps: PromptRefuseDeps): Promise<HookReply | undefined> {
  const found = await sessionTeam(event.cwd, runtime);
  if (found.kind !== 'team') {
    return undefined;
  }
  const kit = await openKit(runtime, found.team);
  const call = refusedCall(hookAsksOf(kit.load), event);
  if (call === undefined || kit.load.status !== 'loaded') {
    return undefined;
  }
  const route = await callRouteOf(runtime, kit, kit.load.config, event, deps.table);
  // The prompt would wait for a person under refuse, so a provably read-only line runs even with the read-only allow off.
  const check = await readonlyCheckOf(runtime, kit.load.config);
  const answer = promptAnswerOf(call, () => callReads(event, check.rules, check.printsSecret), route?.id, hintOf(runtime, call, deps.table));
  const facts = { at: new Date(runtime.clock.now()), session: envSession(runtime), claudeSession: event.session ?? null, call, answer };
  const record = promptAnswerRecord(facts, new SecretScanner(kit.load.config.register.secretPatterns));
  // Best effort: the log feeds the daily triage, and a full disk or a held lock must not turn the answer into an open prompt.
  await hookLogOf(runtime, kit.paths, 'prompt-answers').append(toJsonlLine(record)).catch(() => undefined);
  return promptAnswerReply(call.name, answer);
}

/**
 * PermissionRequest: under `prompts.hookAsks: refuse` in the team config, answers the permission prompt Claude Code is
 * about to raise, per case (hooks/prompt-refuse.ts): a Bash line that runs a sanctioned route (permissions/sanctioned.ts)
 * or provably only reads runs; a line teamrig's rules give a rerun form is refused quoting it; anything else is refused
 * with a reason that says to record the step as waiting for the owner and take the next task, and that names, for a
 * bash line of one of teamrig's own commands, the route form or synced allow rule it takes. It logs each answer to
 * `state/prompt-answers.jsonl`, its command masked (hooks/log-mask.ts), a route's only by its id; the log's records
 * over a week old move to `state/archive/` (cli/hook-logs.ts). Outside a team, with asks on or the config missing or
 * broken, for the question picker or plan mode's exit, for input that is not a hook payload or on any error, it prints
 * nothing, so the prompt opens.
 */
export function promptRefuse(deps: PromptRefuseDeps): (args: ParsedArgs, runtime: CliRuntime) => Promise<ExitCode> {
  return async (args, runtime) => {
    noPositionals(args);
    const { event } = await readHookInput(runtime);
    const reply = event === undefined ? undefined : await promptRefuseReplyOf(runtime, event, deps).catch(() => undefined);
    writeReply(runtime, 'permission-prompt', reply);
    return EXIT.ok;
  };
}
