import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAntigravityToolName } from './tool-call.ts';
import { agyMatcherOf } from './tool-matchers.ts';

describe('agyMatcherOf', () => {
  it('names agy’s shell tool for Claude Code’s two shells, once (T5033)', () => {
    assert.deepEqual(agyMatcherOf('Bash|PowerShell'), { ok: true, matcher: 'run_command' });
  });

  it('names every agy tool that does a Claude Code tool’s job, in the table’s order', () => {
    assert.deepEqual(agyMatcherOf('Read|Grep'), { ok: true, matcher: 'view_file|read_file|grep_search' });
    assert.deepEqual(agyMatcherOf('Write|Edit|MultiEdit|NotebookEdit'), {
      ok: true,
      matcher: 'write_to_file|write_file|replace_file_content|edit_file|multi_replace_file_content',
    });
    assert.deepEqual(agyMatcherOf('AskUserQuestion|Bash'), { ok: true, matcher: 'ask_question|run_command' });
  });

  it('keeps the every-tool matcher', () => {
    assert.deepEqual(agyMatcherOf('*'), { ok: true, matcher: '*' });
  });

  it('names no tool when agy has none of the matcher’s tools', () => {
    assert.deepEqual(agyMatcherOf('NotebookEdit|ExitPlanMode'), { ok: true, matcher: undefined });
  });

  it('refuses a tool, or an empty name, it has no rule for', () => {
    assert.deepEqual(agyMatcherOf('Bash|LSP'), { ok: false, reason: 'the matcher Bash|LSP names the tool LSP, which has no rule for an Antigravity tool' });
    assert.deepEqual(agyMatcherOf('Bash|'), { ok: false, reason: 'the matcher Bash| names an empty tool, which has no rule for an Antigravity tool' });
    assert.deepEqual(agyMatcherOf('Bash.*'), { ok: false, reason: 'the matcher Bash.* names the tool Bash.*, which has no rule for an Antigravity tool' });
  });

  it('writes only tools the tool-call port reads', () => {
    for (const source of ['Bash', 'Read', 'Grep', 'Glob', 'Write', 'Edit', 'MultiEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'SendMessage', 'AskUserQuestion']) {
      const rewritten = agyMatcherOf(source);
      assert.ok(rewritten.ok && rewritten.matcher !== undefined, source);
      for (const tool of rewritten.matcher.split('|')) {
        assert.ok(isAntigravityToolName(tool), `${source} maps to ${tool}`);
      }
    }
  });
});
