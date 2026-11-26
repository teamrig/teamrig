import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parseSnapshot } from '../budget/snapshot.ts';
import { WEEK_SUMMARY_FILE } from '../budget/week-summary.ts';
import type { DatedRateLimits } from '../ports/host/index.ts';
import { APP, CLAUDE_SESSION, CliHarness, KIT, TEAM } from '../testing/cli-harness.ts';
import { hostReadingTranscriptWeek, SHIPPED_HOST } from '../testing/host.ts';
import { EXIT } from './runtime.ts';

const LIVE = join(KIT, 'usage', 'live');
const TRANSCRIPT = join(APP, 'rollout.jsonl');
const RESETS_AT = Date.parse('2030-01-12T03:00:00.000Z');
const READING: DatedRateLimits = { limits: { fiveHour: null, sevenDay: { usedPct: 61, resetsAt: RESETS_AT } }, at: Date.parse('2030-01-08T09:58:00.000Z') };

/** A meter that finds the reading only in a tail naming it, as Codex's finds a token_count line. */
function readsTold(tail: string): DatedRateLimits | undefined {
  return tail.includes('token_count') ? READING : undefined;
}

function stopInput(session: string = CLAUDE_SESSION): string {
  return JSON.stringify({ hook_event_name: 'Stop', session_id: session, cwd: APP, transcript_path: TRANSCRIPT, stop_hook_active: false });
}

async function stopWith(transcript: string | undefined, options: { readonly host?: typeof SHIPPED_HOST; readonly session?: string } = {}): Promise<{ readonly kit: CliHarness; readonly code: number; readonly stderr: readonly string[] }> {
  const kit = new CliHarness(TEAM);
  if (transcript !== undefined) {
    await kit.files.write(TRANSCRIPT, transcript);
  }
  const result = await kit.run(['hook', 'stop'], { stdin: stopInput(options.session), env: { TEAMRIG_SESSION: 'lead' }, host: options.host ?? hostReadingTranscriptWeek(readsTold) });
  return { kit, code: result.code, stderr: result.stderr };
}

describe("the Stop hook saves the plan's reading a transcript tells (T5060)", () => {
  it("saves the transcript's reading as the session's snapshot and folds it into the week summary", async () => {
    const { kit, code } = await stopWith('{"type":"event_msg","payload":{"type":"token_count"}}\n');
    assert.equal(code, EXIT.ok);
    const saved = parseSnapshot(kit.files.get(join(LIVE, `${CLAUDE_SESSION}.json`)) ?? '');
    assert.deepEqual([saved?.sessionId, saved?.cwd, saved?.rateLimits, saved?.rateLimitsSince], [CLAUDE_SESSION, APP, READING.limits, '2030-01-08T09:58:00.000Z']);
    assert.match(kit.files.get(join(LIVE, WEEK_SUMMARY_FILE)) ?? '', /"used_percentage":61/);
  });

  it('saves nothing when the tail tells no reading, the transcript is missing or the session id is not one', async () => {
    for (const [transcript, session] of [['{"type":"response_item"}\n', CLAUDE_SESSION], [undefined, CLAUDE_SESSION], ['token_count\n', 'not-a-session']] as const) {
      const { kit, code } = await stopWith(transcript, { session });
      assert.equal(code, EXIT.ok);
      assert.deepEqual([kit.files.get(join(LIVE, `${session}.json`)), kit.files.get(join(LIVE, WEEK_SUMMARY_FILE))], [undefined, undefined], `${transcript ?? 'missing'} ${session}`);
    }
  });

  it("reads no transcript in a host whose meter reads no week from one, as Claude Code's, whose status line saves it", async () => {
    const { kit, code } = await stopWith('token_count\n', { host: SHIPPED_HOST });
    assert.equal(code, EXIT.ok);
    assert.equal(kit.files.get(join(LIVE, `${CLAUDE_SESSION}.json`)), undefined);
  });
});
