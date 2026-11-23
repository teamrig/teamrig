import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nodeTerminal } from './terminal.ts';

describe('nodeTerminal', () => {
  it('is interactive only when both stdin and stdout are terminals', () => {
    assert.equal(nodeTerminal({ isTTY: true }, { isTTY: true }).interactive, true);
    assert.equal(nodeTerminal({ isTTY: true }, {}).interactive, false);
    assert.equal(nodeTerminal({}, { isTTY: true }).interactive, false);
    assert.equal(nodeTerminal({ isTTY: false }, { isTTY: false }).interactive, false);
  });

  it('runs a program to its end and gives its exit code', async () => {
    const end = await nodeTerminal({}, {}).run({ program: process.execPath, args: ['-e', 'process.exit(3)'] });
    assert.deepEqual(end, { kind: 'exited', code: 3 });
  });

  it('rejects when the program cannot start', async () => {
    await assert.rejects(nodeTerminal({}, {}).run({ program: 'teamrig-no-such-program', args: [] }));
  });
});
