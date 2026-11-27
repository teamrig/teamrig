import { KIT_NAME } from '../core/home.ts';
import { GUARD_HOOKS } from './guard-runner.ts';
import { hooksOf } from './host.ts';
import type { CliRuntime } from './runtime.ts';

/** The words a hook command's name starts with in the command table (`hook push-guard`). */
const HOOK_PREFIX = 'hook ';

/**
 * The gate a guard hook passes before it runs, on a host whose hook line names the event (`--host-event`) because its
 * input does not (T5574). Each guard treats an input its host's bridge reads no event from as nothing asked, and so
 * passes the call; on such a host that input is the host's own call to the guard in a shape teamrig cannot read, so
 * the gate refuses it with the bridge's reason instead. It reads the input once and hands the command a runtime that
 * returns that same text. Undefined when it refused, the reply already written; any other hook, or a host that names
 * no such reason, runs as it was.
 */
export async function guardInputGate(command: string, runtime: CliRuntime & { readonly hostEvent: string }): Promise<CliRuntime | undefined> {
  if (!command.startsWith(HOOK_PREFIX) || !GUARD_HOOKS.has(command.slice(HOOK_PREFIX.length))) {
    return runtime;
  }
  const hooks = hooksOf(runtime);
  if (hooks.unreadable === undefined) {
    return runtime;
  }
  const raw = await runtime.readStdin();
  const reason = hooks.unreadable(raw, runtime.hostEvent);
  if (reason === undefined) {
    return { ...runtime, readStdin: () => Promise.resolve(raw) };
  }
  const text = hooks.reply('tool-start', {
    verdict: { kind: 'deny', reason: `${KIT_NAME}: ${command.slice(HOOK_PREFIX.length)} refused this call: ${reason}, so it cannot check it` },
  });
  if (text !== '') {
    runtime.out.stdout(text);
  }
  return undefined;
}
