import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../args.ts';
import { COMMAND_FLAGS, COMMAND_SWITCHES } from '../run.ts';
import { KIT_NAME } from '../../core/home.ts';
import { idleWakeLine } from './hook-idle-pass.ts';

describe('idleWakeLine (#1354)', () => {
  it('names a set command that parses as set usage, so a session that follows it word for word is not refused', () => {
    const line = idleWakeLine(['T1', 'T2'], '10:00 EST');
    const named = new RegExp(`\\(${KIT_NAME} (set [^)]*)\\)`, 'u').exec(line)?.[1];
    assert.ok(named !== undefined, line);
    const parsed = parseArgs(named.split(' '), COMMAND_FLAGS, COMMAND_SWITCHES);
    assert.equal(parsed.command, 'set');
    assert.deepEqual(parsed.positionals, ['<id>']);
    assert.equal(parsed.flags.get('status'), 'waiting');
    assert.ok(parsed.flags.has('waits'));
  });
});
