import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAntigravitySessionProcess } from './session-process.ts';

describe('isAntigravitySessionProcess', () => {
  it("passes agy's own program by its file name, on any system", () => {
    for (const name of ['agy', 'agy.exe', 'AGY.EXE']) {
      assert.equal(isAntigravitySessionProcess({ name, commandLine: '' }), true, name);
    }
  });

  it('refuses every other program, a name holding agy among them, and a runtime naming agy in its arguments', () => {
    for (const [name, commandLine] of [
      ['agy-helper.exe', ''],
      ['legacy.exe', ''],
      ['myagy', ''],
      ['agy.exe.bak', ''],
      ['claude.exe', ''],
      ['node.exe', 'node.exe C:\\tools\\agy\\agy.js'],
      ['bash', 'bash -c agy'],
    ] as const) {
      assert.equal(isAntigravitySessionProcess({ name, commandLine }), false, `${name} ${commandLine}`);
    }
  });
});
