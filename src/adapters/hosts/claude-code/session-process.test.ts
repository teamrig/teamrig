import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sessionLauncher } from './session-launcher.ts';
import { isSessionProcess } from './session-process.ts';

describe("Claude Code's session process", () => {
  it('is known by its own binary, whatever its command line', () => {
    assert.equal(isSessionProcess({ name: 'claude.exe', commandLine: '' }), true);
    assert.equal(isSessionProcess({ name: 'Claude', commandLine: '' }), true);
    assert.equal(isSessionProcess({ name: 'claude', commandLine: 'claude --resume 0f3c2a1b-9d4e-4c7a-8b21-5e6f7a8b9c0d' }), true);
  });

  it('is never Node.js, whatever script it runs: the binary is the session, a Node.js script under a .claude folder only a plugin or hook (T4891 N1)', () => {
    assert.equal(isSessionProcess({ name: 'node.exe', commandLine: 'node C:/Users/me/.claude/plugins/cache/tool/bin/run.js' }), false);
    assert.equal(isSessionProcess({ name: 'node', commandLine: 'node /home/me/.claude/hooks/notify.mjs' }), false);
    assert.equal(isSessionProcess({ name: 'NODE.EXE', commandLine: 'node C:/tools/Claude/cli.js' }), false);
    assert.equal(isSessionProcess({ name: 'node', commandLine: 'node /usr/lib/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs' }), false);
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
