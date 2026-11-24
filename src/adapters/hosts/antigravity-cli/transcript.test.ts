import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { antigravityTranscriptReader } from './transcript.ts';

const USER_LINE = JSON.stringify({
  step_index: 0,
  source: 'USER_EXPLICIT',
  type: 'USER_INPUT',
  status: 'DONE',
  created_at: '2026-11-24T05:49:01Z',
  content: 'Run echo tool_probe',
});

const TOOL_REPLY_LINE = JSON.stringify({
  step_index: 1,
  source: 'MODEL',
  type: 'PLANNER_RESPONSE',
  status: 'DONE',
  created_at: '2026-11-24T05:49:01Z',
  model: 'gemini-4-neon-high',
  input_tokens: 9552,
  cache_read_tokens: 0,
  output_tokens: 85,
  tool_calls: [{ name: 'run_command', args: { CommandLine: 'echo tool_probe' } }, 'ignored', { args: {} }],
});

const GENERIC_LINE = JSON.stringify({
  step_index: 2,
  source: 'MODEL',
  type: 'GENERIC',
  status: 'DONE',
  created_at: '2026-11-24T05:49:05Z',
  content: 'tool_probe',
});

describe('antigravityTranscriptReader', () => {
  it('parses USER_INPUT, PLANNER_RESPONSE with tool_calls/usage, and GENERIC lines from agy 1.5.14', () => {
    const user = antigravityTranscriptReader.entry(USER_LINE);
    assert.equal(user?.kind, 'input');
    if (user?.kind !== 'input') return;
    assert.equal(user.id, '0');
    assert.equal(user.origin, 'person');
    assert.equal(user.fromTool, false);
    assert.equal(user.text, 'Run echo tool_probe');
    assert.equal(user.at, Date.parse('2026-11-24T05:49:01Z'));

    const reply = antigravityTranscriptReader.entry(TOOL_REPLY_LINE);
    assert.equal(reply?.kind, 'reply');
    if (reply?.kind !== 'reply') return;
    assert.equal(reply.model, 'gemini-4-neon-high');
    assert.deepEqual(reply.usage, { input: 9552, cacheWrite5m: 0, cacheWrite1h: 0, cacheWriteUnsplit: 0, cacheRead: 0, output: 85 });
    assert.deepEqual(reply.calls, [{ id: '1:0', name: 'run_command', input: { CommandLine: 'echo tool_probe' } }]);
    assert.deepEqual(reply.texts, []);
    assert.equal(reply.failed, false);

    const generic = antigravityTranscriptReader.entry(GENERIC_LINE);
    assert.equal(generic?.kind, 'input');
    if (generic?.kind !== 'input') return;
    assert.equal(generic.fromTool, true);
    assert.equal(generic.text, 'tool_probe');
  });

  it('handles blank, damaged, non-object, other, failed, and unreadable usage lines', () => {
    assert.equal(antigravityTranscriptReader.entry('   '), undefined);
    assert.deepEqual(antigravityTranscriptReader.entry('{bad'), { kind: 'unread', reason: 'damaged' });
    assert.deepEqual(antigravityTranscriptReader.entry('[]'), { kind: 'unread', reason: 'not-an-object' });
    assert.equal(antigravityTranscriptReader.lastPlanSlug(USER_LINE), undefined);

    const other = antigravityTranscriptReader.entry(JSON.stringify({ type: 'CUSTOM', step_index: 9 }));
    assert.equal(other?.kind, 'other');

    const failed = antigravityTranscriptReader.entry(JSON.stringify({
      type: 'PLANNER_RESPONSE',
      status: 'FAILED',
      error: 'boom',
      content: 'hi',
      input_tokens: -1,
      output_tokens: 5,
      tool_calls: [{ name: 'read_file' }],
    }));
    assert.equal(failed?.kind, 'reply');
    if (failed?.kind !== 'reply') return;
    assert.equal(failed.failed, true);
    assert.equal(failed.error, 'boom');
    assert.equal(failed.usage, 'unreadable');
    assert.deepEqual(failed.texts, ['hi']);
    assert.deepEqual(failed.calls, [{ id: 'step:0', name: 'read_file', input: undefined }]);

    assert.equal(antigravityTranscriptReader.entry(USER_LINE, ['reply']), undefined);
    assert.deepEqual(antigravityTranscriptReader.entry('{bad', ['reply']), { kind: 'unread', reason: 'damaged' });
  });
});
