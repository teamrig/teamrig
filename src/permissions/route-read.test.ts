import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_TABLE } from '../cli/run.ts';
import { readable } from '../slash/plan.ts';
import { fitsReadRoute, READ_ROUTE_COMMANDS, READ_ROUTE_EXCLUDED } from './route-read.ts';

/** True when the CLI reads `line` (no program word) as a read route. */
function fits(line: string): boolean {
  const parsed = readable(line.split(' '), COMMAND_TABLE);
  return parsed !== undefined && fitsReadRoute(parsed);
}

describe('READ_ROUTE_COMMANDS', () => {
  it('C3: holds every read row of the CLI table in exactly one list, and only read rows', () => {
    const reads = Object.keys(COMMAND_TABLE.effects).filter((command) => COMMAND_TABLE.effects[command] === 'read');
    for (const command of reads) {
      const listed = [READ_ROUTE_COMMANDS.has(command), READ_ROUTE_EXCLUDED.has(command)].filter(Boolean).length;
      assert.equal(listed, 1, `${command} is a read row: put it in READ_ROUTE_COMMANDS or READ_ROUTE_EXCLUDED`);
    }
    for (const command of [...READ_ROUTE_COMMANDS.keys(), ...READ_ROUTE_EXCLUDED.keys()]) {
      assert.equal(COMMAND_TABLE.effects[command], 'read', `${command} is listed but is no read row`);
    }
  });

  it('C4: leaves out secrets message, which prints from a file the caller names', () => {
    assert.equal(fits('secrets message C:/w/.git/COMMIT_EDITMSG'), false);
  });

  it('leaves out key list and key check, which read the credential store', () => {
    assert.equal(fits('key list'), false);
    assert.equal(fits('key check'), false);
  });
});

describe('fitsReadRoute', () => {
  it('passes a listed command with its table flags and the positionals it takes', () => {
    for (const line of [
      'list --session tr-x --status open',
      'show T1 T2 --session tr-x',
      'who',
      'who tr-x',
      'budget',
      'goal show G1',
      'read --session tr-x --since 2h',
      'config get',
      'sessions',
      'setup scan',
      'commits check --base main',
      'steps',
    ]) {
      assert.equal(fits(line), true, line);
    }
  });

  it('passes steps, which lists the pending steps, and never steps run, which takes one', () => {
    assert.equal(fits('steps --session tr-x'), true);
    for (const line of ['steps run config-format', 'steps run config-format --yes', 'steps config-format']) {
      assert.equal(fits(line), false, line);
    }
  });

  it('C4: refuses sessions and setup scan with --project', () => {
    assert.equal(fits('sessions --project C:/w'), false);
    assert.equal(fits('setup scan --project C:/w'), false);
  });

  it('refuses a missing, extra or wrong positional, an unknown flag, and any value starting with -', () => {
    for (const line of [
      'list T1',
      'goal show',
      'goal show G1 G2',
      'who tr-x tr-y',
      'list --no-such-flag',
      'commits check --base --output=x',
      'commits check --base=-x',
      'show -x',
      'list --session -x',
    ]) {
      assert.equal(fits(line), false, line);
    }
  });

  it('refuses a command that is no read route', () => {
    for (const line of ['set T1 --status done', 'inbox read', 'inbox add --to x --text y', 'exec run', 'merge']) {
      assert.equal(fits(line), false, line);
    }
  });
});
