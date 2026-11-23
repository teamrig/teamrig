import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toolCallShape } from './tool-call.ts';

describe("Antigravity's tool calls", () => {
  const win = toolCallShape('win32');
  const linux = toolCallShape('linux');

  it('normalizes run_command with bash dialect while Windows dialect is unproven', () => {
    assert.deepEqual(win.normalize('run_command', { CommandLine: 'git status' }), {
      kind: 'shell',
      name: 'run_command',
      input: { CommandLine: 'git status' },
      dialect: 'bash',
      command: 'git status',
      readings: ['git status'],
    });
    assert.deepEqual(linux.normalize('run_command', {}), {
      kind: 'shell',
      name: 'run_command',
      input: {},
      dialect: 'bash',
      command: undefined,
      readings: [],
    });
  });

  it('normalizes documented file tools (view_file, write_to_file, replace_file_content, multi_replace_file_content)', () => {
    assert.deepEqual(linux.normalize('view_file', { AbsolutePath: '/a/b.ts' }), {
      kind: 'read',
      name: 'view_file',
      input: { AbsolutePath: '/a/b.ts' },
      path: '/a/b.ts',
    });
    assert.deepEqual(linux.normalize('write_to_file', { TargetFile: JSON.stringify('/a/b.ts'), CodeContent: 'hello' }), {
      kind: 'edit',
      name: 'write_to_file',
      input: { TargetFile: '"/a/b.ts"', CodeContent: 'hello' },
      files: [{ path: '/a/b.ts', texts: ['hello'], change: { kind: 'whole', text: 'hello' } }],
    });
    assert.deepEqual(
      linux.normalize('replace_file_content', {
        TargetFile: '/a/b.ts',
        TargetContent: 'old',
        ReplacementContent: 'new',
        AllowMultiple: true,
      }),
      {
        kind: 'edit',
        name: 'replace_file_content',
        input: { TargetFile: '/a/b.ts', TargetContent: 'old', ReplacementContent: 'new', AllowMultiple: true },
        files: [{ path: '/a/b.ts', texts: ['new'], change: { kind: 'replacements', replacements: [{ from: 'old', to: 'new', all: true }] } }],
      },
    );
    assert.deepEqual(
      linux.normalize('multi_replace_file_content', {
        TargetFile: '/a/b.ts',
        ReplacementChunks: [
          { TargetContent: 'a', ReplacementContent: 'b', AllowMultiple: false },
          { TargetContent: 'c', ReplacementContent: 'd', AllowMultiple: true },
        ],
      }),
      {
        kind: 'edit',
        name: 'multi_replace_file_content',
        input: {
          TargetFile: '/a/b.ts',
          ReplacementChunks: [
            { TargetContent: 'a', ReplacementContent: 'b', AllowMultiple: false },
            { TargetContent: 'c', ReplacementContent: 'd', AllowMultiple: true },
          ],
        },
        files: [
          {
            path: '/a/b.ts',
            texts: ['b', 'd'],
            change: {
              kind: 'replacements',
              replacements: [
                { from: 'a', to: 'b', all: false },
                { from: 'c', to: 'd', all: true },
              ],
            },
          },
        ],
      },
    );
  });

  it('normalizes fallback file tools (read_file, write_file, edit_file) and missing fields', () => {
    assert.equal(linux.normalize('read_file', { Path: '/a/b.ts' }).kind, 'read');
    assert.deepEqual(linux.normalize('write_file', { Path: '/a/b.ts' }), {
      kind: 'edit',
      name: 'write_file',
      input: { Path: '/a/b.ts' },
      files: [{ path: '/a/b.ts', texts: [], change: undefined }],
    });
    assert.deepEqual(linux.normalize('edit_file', { Path: '/a/b.ts' }), {
      kind: 'edit',
      name: 'edit_file',
      input: { Path: '/a/b.ts' },
      files: [{ path: '/a/b.ts', texts: [], change: undefined }],
    });
    assert.deepEqual(linux.normalize('multi_replace_file_content', { TargetFile: '"{bad' }), {
      kind: 'edit',
      name: 'multi_replace_file_content',
      input: { TargetFile: '"{bad' },
      files: [{ path: '"{bad', texts: [], change: undefined }],
    });
  });

  it('normalizes search, web, helper (including swarm), message, ask, schedule, and unknown tools', () => {
    assert.equal(linux.normalize('grep_search', { SearchPath: '/src' }).kind, 'search');
    assert.equal(linux.normalize('find_by_name', { SearchDirectory: '/src', Pattern: '*.ts' }).kind, 'search');
    assert.equal(linux.normalize('list_dir', { DirectoryPath: '/src' }).kind, 'search');
    assert.equal(linux.normalize('read_url_content', { Url: 'https://example.com' }).kind, 'web');
    assert.deepEqual(linux.normalize('search_web', { query: 'teamrig' }), {
      kind: 'web',
      name: 'search_web',
      input: { query: 'teamrig' },
      url: undefined,
    });
    assert.deepEqual(linux.normalize('invoke_subagent', { TypeName: 'research' }), {
      kind: 'helper',
      name: 'invoke_subagent',
      input: { TypeName: 'research' },
      type: 'research',
    });
    assert.deepEqual(linux.normalize('swarm', { action: 'status' }), {
      kind: 'helper',
      name: 'swarm',
      input: { action: 'status' },
      type: 'status',
    });
    assert.deepEqual(linux.normalize('send_message', { Recipient: 'agent-1', Message: 'done' }), {
      kind: 'message',
      name: 'send_message',
      input: { Recipient: 'agent-1', Message: 'done' },
      to: 'agent-1',
      text: 'done',
    });
    assert.deepEqual(linux.normalize('ask_question', { questions: [{ question: 'Proceed?' }] }), {
      kind: 'ask',
      name: 'ask_question',
      input: { questions: [{ question: 'Proceed?' }] },
      asks: 'question',
      question: 'Proceed?',
    });
    assert.equal(linux.normalize('schedule', { Prompt: 'check' }).kind, 'schedule');
    assert.equal(linux.normalize('manage_task', { Action: 'list' }).kind, 'other');
  });
});
