import { DEFAULT_HOST } from '../composition/adapters.ts';
import type { Roster } from '../config/roster.ts';
import type { KitConfig } from '../config/types.ts';
import { errorMessage } from '../core/guards.ts';
import { LockBusyError } from '../core/lock.ts';
import { findProgram } from '../open/host-program.ts';
import { isUnsupported, type SessionWake, type WakeDelivery } from '../ports/host/index.ts';
import { SessionRecordStore, type SessionRecord } from '../sessions/record.ts';
import { logWake } from '../wake/store.ts';
import { wakeAnswerOf, type WakeAnswer, type WakeTarget } from './commands/hook-wake.ts';
import type { Kit } from './kit.ts';
import type { CliRuntime } from './runtime.ts';

/**
 * What came of one session's check: woken through its host's program, nothing to wake it for now (`quiet`), or a wake
 * its host did not take (`no-session`, `failed` with why). Sessions of the default host, and ones not running, are
 * left out: the plugin's mod in their own tab wakes them.
 */
export type HostWakeResult =
  | { readonly id: string; readonly kind: 'woken' | 'quiet' | 'no-session' }
  | { readonly id: string; readonly kind: 'failed'; readonly reason: string };

/** A session's way in: its record, and the wake and program of the host it runs in. */
interface HostedSession {
  readonly id: string;
  readonly record: SessionRecord;
  readonly runtime: CliRuntime;
  readonly program: string;
  readonly wake: SessionWake;
}

/**
 * The running session `id` of a host that wakes its sessions through its own program, from its record; undefined for
 * one of the default host (its tab's mod wakes it), with no record, no longer running, or on a host with no such wake.
 */
function hostedSessionOf(runtime: CliRuntime, id: string, record: SessionRecord | undefined): HostedSession | undefined {
  const host = record?.host;
  if (record === undefined || host === undefined || host === DEFAULT_HOST || !runtime.sessionProcesses.alive(record.claudePid)) {
    return undefined;
  }
  const shipped = runtime.shippedHosts[host];
  if (shipped === undefined) {
    return undefined;
  }
  const { launcher } = shipped.ports({ env: runtime.env, platform: runtime.platform });
  if (isUnsupported(launcher) || isUnsupported(launcher.wake)) {
    return undefined;
  }
  // Every read the decision makes (its transcript, its folders) is the session's own host's.
  return { id, record, runtime: { ...runtime, host: shipped.ports }, program: launcher.program, wake: launcher.wake };
}

/** Hands the session the prompt through its host's program, found on PATH as a start finds it; never throws. */
async function deliver(session: HostedSession, text: string): Promise<WakeDelivery> {
  const { runtime } = session;
  try {
    const found = await findProgram({ env: runtime.env, platform: runtime.platform, probe: runtime.probe, files: runtime.files, node: runtime.self.node }, session.program);
    if (found.kind === 'missing') {
      return { kind: 'failed', reason: `${session.program} is not on PATH` };
    }
    const args = [...found.program.prefix, ...session.wake.args(session.record.hostSession, text)];
    return session.wake.outcome(await runtime.run({ program: found.program.command, args }));
  } catch (error) {
    return { kind: 'failed', reason: errorMessage(error) };
  }
}

/** The session's wake answer; undefined while another check of it holds its wake lock and decides now. */
async function answerUnlessBusy(runtime: CliRuntime, scope: WakeTarget): Promise<WakeAnswer | undefined> {
  try {
    return await wakeAnswerOf(runtime, scope, undefined);
  } catch (error) {
    if (error instanceof LockBusyError) {
      return undefined;
    }
    throw error;
  }
}

/** One session's check and, on a wake, its delivery; a wake its host did not take is logged dropped with why. */
async function wakeOne(session: HostedSession, kit: Kit, config: KitConfig, roster: Roster): Promise<HostWakeResult> {
  const { id, record, runtime } = session;
  const tab = record.hostSession;
  const answer = await answerUnlessBusy(runtime, { kind: 'found', kit, config, roster, id, tab });
  if (answer?.kind !== 'wake') {
    return { id, kind: 'quiet' };
  }
  const delivery = await deliver(session, answer.text);
  if (delivery.kind === 'delivered') {
    return { id, kind: 'woken' };
  }
  // The decision kept the wake as sent: a wake the host did not take waits for the next re-wake (wake.maxGapMinutes).
  const reason = delivery.kind === 'failed' ? delivery.reason : 'the host runs no session of that id';
  await logWake(runtime.files, kit.paths.wakeLog, { kind: 'dropped', at: runtime.clock.now(), session: id, tab, reason });
  return delivery.kind === 'failed' ? { id, kind: 'failed', reason } : { id, kind: 'no-session' };
}

/**
 * Wakes the team's running sessions of a host that has no tab mod to wake them, such as Codex CLI (T5059): each is
 * checked as the mod checks its own tab (`wakeAnswerOf`) and, on a wake, handed the prompt through its host's program.
 * `ids` limits it to those sessions (a line posted for one); the idle pass checks the whole roster. Off with
 * `wake.enabled` false.
 */
export async function wakeHostSessions(
  runtime: CliRuntime,
  kit: Kit,
  config: KitConfig,
  roster: Roster,
  ids: readonly string[] = roster.ids,
): Promise<readonly HostWakeResult[]> {
  if (!config.wake.enabled) {
    return [];
  }
  const records = await new SessionRecordStore(runtime.files, kit.paths).readEach(ids);
  const sessions = [...records].flatMap(([id, record]) => hostedSessionOf(runtime, id, record) ?? []);
  const results: HostWakeResult[] = [];
  for (const session of sessions) {
    results.push(await wakeOne(session, kit, config, roster));
  }
  return results;
}
