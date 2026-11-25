import { wakesThroughProgram } from '../host.ts';
import type { CliRuntime } from '../runtime.ts';
import type { HookOrigin } from './hook-input.ts';

/**
 * Runs the team's idle pass at a turn's end in a host with no tab mod, such as Codex CLI (T5059). A Claude Code tab's
 * mod runs the pass from its wake check while the tab sits idle (`wakeCheck`, hook-wake.ts); a Codex session has no
 * such mod, so without this a team whose sessions all run in Codex would never run its pass, and so never wake them.
 * The pass keeps its own gates: mode off reads nothing, and it runs at most once a minute across the team, under a
 * lock no caller waits for. The wake check's module loads only on such a host, so a Claude Code turn pays nothing.
 */
export async function turnEndIdlePass(runtime: CliRuntime, origin: HookOrigin): Promise<void> {
  if (!wakesThroughProgram(runtime)) {
    return;
  }
  const { idlePassOfScope } = await import('./hook-wake.ts');
  await idlePassOfScope(runtime, origin);
}
