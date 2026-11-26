import type { Roster } from '../config/roster.ts';
import type { KitConfig } from '../config/types.ts';
import { errorMessage } from '../core/guards.ts';
import { KIT_NAME } from '../core/home.ts';
import { SessionRecordStore } from '../sessions/record.ts';
import type { Kit } from './kit.ts';
import type { CliRuntime } from './runtime.ts';

/**
 * Wakes those of `ids` that run in a host with no tab mod to wake them, such as Codex CLI (src/cli/host-wake.ts):
 * the idle pass once a pass, and a post that asks a wake at once, call it. Its module, which loads the whole wake
 * check, is loaded only when one of them has a host in its record, so a team with none pays for no more than the
 * record reads. A WARN line for each wake that failed; never throws.
 */
export async function wakeHostedSessions(runtime: CliRuntime, kit: Kit, config: KitConfig, roster: Roster, ids: readonly string[]): Promise<readonly string[]> {
  try {
    const records = await new SessionRecordStore(runtime.files, kit.paths).readEach(ids);
    const hosted = [...records].filter(([, record]) => record?.host !== undefined).map(([id]) => id);
    if (hosted.length === 0) {
      return [];
    }
    const { wakeHostSessions } = await import('./host-wake.ts');
    const results = await wakeHostSessions(runtime, kit, config, roster, hosted);
    return results.flatMap((result) => (result.kind === 'failed' ? [`WARN ${KIT_NAME} could not wake ${result.id} through its host: ${result.reason}`] : []));
  } catch (error) {
    return [`WARN ${KIT_NAME} could not wake ${ids.join(', ')} through their host: ${errorMessage(error)}`];
  }
}
