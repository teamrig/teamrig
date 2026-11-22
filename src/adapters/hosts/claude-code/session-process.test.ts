import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sessionLauncher } from './session-launcher.ts';
import { isSessionProcess } from './session-process.ts';

describe("Claude Code's session process", () => {
  it('is known by its binary, or by Node.js running its script', () => {
    assert.equal(isSessionProcess({ name: 'claude.exe', commandLine: '' }), true);
    assert.equal(isSessionProcess({ name: 'Claude', commandLine: '' }), true);
    assert.equal(isSessionProcess({ name: 'node', commandLine: 'node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js' }), true);
    assert.equal(isSessionProcess({ name: 'NODE.EXE', commandLine: 'node C:/tools/Claude/cli.js' }), true);
  });

  it('is no other program: Node.js running another script, a program whose name only starts the same, one named in a command line alone', () => {
    assert.equal(isSessionProcess({ name: 'node.exe', commandLine: 'node C:/tools/build.js' }), false);
    assert.equal(isSessionProcess({ name: 'claude-helper', commandLine: '' }), false);
    assert.equal(isSessionProcess({ name: 'bash', commandLine: 'bash -c claude' }), false);
    assert.equal(isSessionProcess({ name: 'node', commandLine: '' }), false);
  });

  it('is what the launcher port answers by, in every environment', () => {
    assert.equal(sessionLauncher({}).isSessionProcess, isSessionProcess);
    assert.equal(sessionLauncher({ CLAUDECODE: '1' }).isSessionProcess, isSessionProcess);
  });
});
