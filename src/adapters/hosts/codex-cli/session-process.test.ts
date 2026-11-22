import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCodexSessionProcess } from './session-process.ts';

const WRAPPER = 'D:\\tools\\npm\\node_modules\\@openai\\codex\\bin\\codex.js';

describe('isCodexSessionProcess', () => {
  it("passes Codex's own binary by its file name, on any system", () => {
    for (const name of ['codex', 'codex.exe', 'CODEX.EXE']) {
      assert.equal(isCodexSessionProcess({ name, commandLine: '' }), true, name);
    }
  });

  it("passes Node.js running Codex's npm wrapper as its first argument, quoted or not, any slashes", () => {
    for (const commandLine of [
      `"C:\\Program Files\\nodejs\\node.exe" "${WRAPPER}" --model x`,
      `node.exe ${WRAPPER}`,
      'node /usr/local/lib/node_modules/@openai/codex/bin/codex.js resume',
    ]) {
      assert.equal(isCodexSessionProcess({ name: commandLine.startsWith('node ') ? 'node' : 'node.exe', commandLine }), true, commandLine);
    }
  });

  it('refuses every other program, and Node.js naming Codex anywhere but as its script', () => {
    for (const [name, commandLine] of [
      ['codex-helper.exe', ''],
      ['mycodex', ''],
      ['claude.exe', ''],
      ['node.exe', 'node.exe C:\\work\\codex\\tools\\run.js'],
      ['node.exe', `node.exe C:\\work\\hook.js ${WRAPPER}`],
      ['node.exe', 'node.exe C:\\work\\@openai\\codex\\bin\\codex.js.bak'],
      ['node.exe', 'node.exe C:\\work\\not@openai\\codex\\bin\\codex.js'],
      ['node.exe', ''],
      ['python.exe', `python.exe ${WRAPPER}`],
    ] as const) {
      assert.equal(isCodexSessionProcess({ name, commandLine }), false, `${name} ${commandLine}`);
    }
  });
});
