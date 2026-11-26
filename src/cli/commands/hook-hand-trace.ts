import { errorMessage, numberField, stringField } from '../../core/guards.ts';
import { TRACE_ERROR_CHARS } from '../../mod/hand-watch.ts';
import { noPositionals, type ParsedArgs } from '../args.ts';
import { hookLogOf } from '../hook-logs.ts';
import { EXIT, type CliRuntime, type ExitCode } from '../runtime.ts';
import { readModRequest } from './hook-input.ts';
import { wakeScopeOf } from './hook-wake.ts';

/** How long a hand's name may be in the log; the mod's hands have one-word names. */
const HAND_CHARS = 40;

/**
 * `hook hand-trace`: the mod's watch over its hands (src/mod/hand-watch.ts) reports a tick that threw or stayed
 * unsettled past its limit, and this appends one line for it to the team's `state/hand-trace.jsonl` (#920), whose
 * records over a week old move to the archive as the other hook logs' do (#1818), so a
 * hand that stopped answering leaves a trace outside Claude Code's debug log. A tab that is no team session, or a
 * payload that names no hand or kind, logs nothing. It always exits 0, a failed append included, which it names on
 * stderr (#1820): the mod never waits on its answer, and a trace of a trace has nowhere better to go.
 */
export async function handTrace(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const request = await readModRequest(runtime);
  if (request === undefined) {
    return EXIT.ok;
  }
  const payload = request.fields;
  const hand = stringField(payload, 'hand')?.slice(0, HAND_CHARS);
  const kind = stringField(payload, 'kind');
  const detail =
    kind === 'threw'
      ? { error: (stringField(payload, 'error') ?? 'no error given').slice(0, TRACE_ERROR_CHARS) }
      : kind === 'stalled'
        ? { ms: Math.max(0, Math.round(numberField(payload, 'ms') ?? 0)) }
        : undefined;
  if (hand === undefined || hand === '' || detail === undefined) {
    return EXIT.ok;
  }
  const scope = await wakeScopeOf(runtime, request.event, false);
  if (scope.kind === 'off') {
    return EXIT.ok;
  }
  const line = { v: 1, at: new Date(runtime.clock.now()).toISOString(), session: scope.id, tab: scope.tab, hand, kind, ...detail };
  try {
    await hookLogOf(runtime, scope.kit.paths, 'hand-trace').append(`${JSON.stringify(line)}\n`);
  } catch (error) {
    runtime.out.stderr(`teamrig hook hand-trace: could not append to ${scope.kit.paths.handTraceLog}: ${errorMessage(error)}`);
  }
  return EXIT.ok;
}
