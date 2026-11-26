import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { isRecord } from '../core/guards.ts';
import type { SessionRestriction } from '../ports/host/index.ts';
import { APP, CLAUDE_SESSION, CliHarness, contextOf, TEAM, type CliResult } from '../testing/cli-harness.ts';
import { hostReadingRestriction, SHIPPED_HOST } from '../testing/host.ts';
import { restrictionLine } from './commands/hook-restriction.ts';
import { EXIT } from './runtime.ts';

const TRANSCRIPT = join(APP, 'rollout.jsonl');
const WORKSPACE: SessionRestriction = { approval: 'never', sandbox: 'workspace-write', network: false, profile: ':workspace' };
const READ_ONLY: SessionRestriction = { approval: 'on-request', sandbox: 'read-only', network: undefined, profile: undefined };

/** A launcher that reads the restriction a tail names by its word, as Codex's reads a turn_context line. */
function readsTold(tail: string): SessionRestriction | undefined {
  if (tail.includes('read-only')) {
    return READ_ONLY;
  }
  return tail.includes('workspace') ? WORKSPACE : undefined;
}

const HOST = hostReadingRestriction(readsTold);

function input(event: 'Stop' | 'SessionStart'): string {
  return JSON.stringify({ hook_event_name: event, session_id: CLAUDE_SESSION, cwd: APP, transcript_path: TRANSCRIPT, stop_hook_active: false, source: 'resume' });
}

function noticeOf(result: CliResult): string {
  const parsed: unknown = JSON.parse(result.stdout[0] ?? '{}');
  return isRecord(parsed) && typeof parsed['systemMessage'] === 'string' ? parsed['systemMessage'] : '';
}

async function stop(kit: CliHarness, transcript: string, host = HOST): Promise<CliResult> {
  await kit.files.write(TRANSCRIPT, transcript);
  const result = await kit.run(['hook', 'stop'], { stdin: input('Stop'), env: { TEAMRIG_SESSION: 'lead' }, host });
  assert.equal(result.code, EXIT.ok);
  return result;
}

describe('the restriction line (T5089)', () => {
  it('says approval never means no prompts alone, names the sandbox, network and profile, and that teamrig changes none', () => {
    assert.equal(
      restrictionLine(WORKSPACE, 'teamrig'),
      "teamrig: this session runs under approval never (no prompts; the sandbox still holds), sandbox workspace-write, network off, profile :workspace. These are the AI CLI's own settings; teamrig changes none of them, and a step they refuse is no sign-in problem.",
    );
  });

  it('leaves out what the host does not say, and names no sandbox as such', () => {
    assert.match(restrictionLine(READ_ONLY, 'teamrig'), /runs under approval on-request, sandbox read-only\. /);
    assert.match(restrictionLine({ ...WORKSPACE, sandbox: 'none', network: true }, 'teamrig'), /no sandbox \(commands write anywhere\), network on/);
  });
});

describe('the Stop hook tells the restriction a session runs under (T5089)', () => {
  it('tells it at the first turn end, not again under the same one, and again when it changes', async () => {
    const kit = new CliHarness(TEAM);
    assert.match(noticeOf(await stop(kit, 'workspace\n')), /approval never \(no prompts; the sandbox still holds\), sandbox workspace-write/);
    assert.doesNotMatch(noticeOf(await stop(kit, 'workspace\n')), /runs under/);
    assert.match(noticeOf(await stop(kit, 'read-only\n')), /approval on-request, sandbox read-only/);
  });

  it('tells nothing, and still ends the turn, when the reader fails', async () => {
    const failing = hostReadingRestriction(() => {
      throw new Error('reader broke');
    });
    assert.doesNotMatch(noticeOf(await stop(new CliHarness(TEAM), 'workspace\n', failing)), /runs under/);
  });

  it('tells nothing for a tail with no turn, nor in a host whose launcher reads none, as Claude Code', async () => {
    assert.doesNotMatch(noticeOf(await stop(new CliHarness(TEAM), 'other\n')), /runs under/);
    assert.doesNotMatch(noticeOf(await stop(new CliHarness(TEAM), 'workspace\n', SHIPPED_HOST)), /runs under/);
  });
});

describe('the SessionStart hook puts the restriction of a resumed session in context (T5089)', () => {
  it("adds the line after the rules when the transcript tells one, and nothing when it tells none", async () => {
    const kit = new CliHarness(TEAM);
    await kit.files.write(TRANSCRIPT, 'workspace\n');
    const told = contextOf(await kit.run(['hook', 'session-start'], { stdin: input('SessionStart'), env: { TEAMRIG_SESSION: 'lead' }, host: HOST }));
    assert.ok(told.endsWith(restrictionLine(WORKSPACE, 'teamrig')));
    await kit.files.write(TRANSCRIPT, 'other\n');
    const none = contextOf(await kit.run(['hook', 'session-start'], { stdin: input('SessionStart'), env: { TEAMRIG_SESSION: 'lead' }, host: HOST }));
    assert.doesNotMatch(none, /runs under/);
  });
});
