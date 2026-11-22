import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { JsonRecord, ToolCall } from '../../../plugin-api/index.ts';
import { toolCallShape } from './tool-call.ts';

const call = (name: string, input: JsonRecord, platform: NodeJS.Platform = 'linux'): ToolCall => toolCallShape(platform).normalize(name, input);

const patch = (...lines: string[]): JsonRecord => ({ command: ['*** Begin Patch', ...lines, '*** End Patch'].join('\n') });

describe('Codex CLI tool calls', () => {
  it('reads a Bash line as PowerShell on Windows and as bash elsewhere, the line as written its one reading', () => {
    const input = { command: 'Remove-Item a\\\\b' };
    assert.deepEqual(call('Bash', input, 'win32'), { kind: 'shell', name: 'Bash', input, dialect: 'powershell', command: 'Remove-Item a\\\\b', readings: ['Remove-Item a\\\\b'] });
    assert.deepEqual(call('Bash', { command: 'ls' }, 'darwin'), { kind: 'shell', name: 'Bash', input: { command: 'ls' }, dialect: 'bash', command: 'ls', readings: ['ls'] });
    assert.deepEqual(call('Bash', { command: 1 }), { kind: 'shell', name: 'Bash', input: { command: 1 }, dialect: 'bash', command: undefined, readings: [] });
  });

  it('reads an added file as the whole text Codex writes: each line followed by a newline', () => {
    const input = patch('*** Add File: src/a.ts', '+one', '+two');
    assert.deepEqual(call('apply_patch', input), {
      kind: 'edit',
      name: 'apply_patch',
      input,
      files: [{ path: 'src/a.ts', texts: ['one\ntwo\n'], change: { kind: 'whole', text: 'one\ntwo\n' } }],
    });
  });

  it('lists every file of a patch: an update by its added lines, a delete, a move at both its ends', () => {
    const input = patch(
      '*** Update File: a.ts',
      '@@',
      '-old',
      '+new',
      '+next',
      '*** Delete File: b.ts',
      '*** Update File: c.ts',
      '*** Move to: .git/local-ci/c.json',
      '@@',
      '-x',
    );
    const read = call('apply_patch', input);
    assert.equal(read.kind, 'edit');
    assert.deepEqual(read.kind === 'edit' ? read.files : [], [
      { path: 'a.ts', texts: ['new\nnext'], change: undefined },
      { path: 'b.ts', texts: [], change: undefined },
      { path: 'c.ts', texts: [], change: undefined },
      { path: '.git/local-ci/c.json', texts: [], change: undefined },
    ]);
  });

  it('reads a patch Codex cannot read either as one file with no path, its whole text written', () => {
    const files = (input: JsonRecord): unknown => {
      const read = call('apply_patch', input);
      return read.kind === 'edit' ? read.files : read.kind;
    };
    assert.deepEqual(files({ command: 'not a patch' }), [{ path: undefined, texts: ['not a patch'], change: undefined }]);
    assert.deepEqual(files({}), [{ path: undefined, texts: [], change: undefined }]);
  });

  it('reads every other tool, an MCP tool too, as other', () => {
    assert.deepEqual(call('mcp__docs__search', { q: 'x' }), { kind: 'other', name: 'mcp__docs__search', input: { q: 'x' } });
    assert.deepEqual(call('Read', { file_path: 'a' }), { kind: 'other', name: 'Read', input: { file_path: 'a' } });
  });
});
