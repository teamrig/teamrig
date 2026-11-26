import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { isRecord } from '../core/guards.ts';
import { CliHarness, TEAM_HOME } from '../testing/cli-harness.ts';
import { FaultyFiles, systemError } from '../testing/faulty-files.ts';
import { ACT_NOT_LOGGED, outcomeOf } from './act-record.ts';
import { EXIT } from './runtime.ts';

const ACTS = join(TEAM_HOME, 'state', 'acts.jsonl');
const ADD = ['add', '--title', 'Ship the CLI', '--description', 'what and why', '--priority', 'p2', '--session', 'alpha'];

function actsOf(kit: CliHarness): readonly Record<string, unknown>[] {
  const text = kit.files.get(ACTS) ?? '';
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const record: unknown = JSON.parse(line);
      assert.ok(isRecord(record));
      return record;
    });
}

describe('the act log of write commands', () => {
  it('logs a write that went through: who, channel, host, command and its words', async () => {
    const kit = new CliHarness();
    const added = await kit.run(ADD);
    assert.equal(added.code, EXIT.ok);
    const [act, ...more] = actsOf(kit);
    assert.deepEqual(more, []);
    assert.deepEqual(act, {
      v: 1,
      at: '2030-01-08T10:00:00.000Z',
      ms: 0,
      session: 'alpha',
      by: { kind: 'person' },
      host: 'claude-code',
      command: 'add',
      argv: ADD,
      outcome: 'ok',
      exit: 0,
      reason: null,
    });
  });

  it("marks an agent's run by its host's mark and takes the session from the environment", async () => {
    const kit = new CliHarness();
    await kit.run(['add', '--title', 'x', '--description', 'what and why', '--priority', 'p2'], { env: { CLAUDECODE: '1', TEAMRIG_SESSION: 'bravo' } });
    const [act] = actsOf(kit);
    assert.deepEqual([act?.['by'], act?.['session']], [{ kind: 'agent', mark: 'CLAUDECODE' }, 'bravo']);
  });

  it('logs a refused write with the reason it printed', async () => {
    const kit = new CliHarness();
    const refused = await kit.run(['set', 'T9', '--status', 'done', '--session', 'alpha']);
    assert.notEqual(refused.code, EXIT.ok);
    const [act] = actsOf(kit);
    const printed = [...refused.stdout, ...refused.stderr].find((line) => line.startsWith('REFUSED ') || line.startsWith('FAILED '));
    assert.ok(printed !== undefined);
    assert.equal(act?.['exit'], refused.code);
    assert.equal(act?.['reason'], printed.replace(/^(REFUSED|FAILED) /, ''));
    assert.ok(act?.['outcome'] === 'refused' || act?.['outcome'] === 'failed');
  });

  it('logs a write whose command threw on its line, and none the parser could not read', async () => {
    const kit = new CliHarness();
    assert.equal((await kit.run(['add', '--titel', 'x', '--session', 'alpha'])).code, EXIT.usage);
    assert.deepEqual(actsOf(kit), []);
    const refused = await kit.run(['add', '--session', 'alpha']);
    assert.equal(refused.code, EXIT.usage);
    const [act] = actsOf(kit);
    assert.equal(act?.['outcome'], 'usage');
    assert.equal(typeof act?.['reason'], 'string');
  });

  it('logs no read', async () => {
    const kit = new CliHarness();
    await kit.run(ADD);
    await kit.run(['list', '--session', 'alpha']);
    assert.deepEqual(
      actsOf(kit).map((act) => act['command']),
      ['add'],
    );
  });

  it('logs no dry run, which promises to write nothing', async () => {
    const kit = new CliHarness();
    await kit.run(ADD);
    const dry = await kit.run(['compact', '--dry-run', '--session', 'alpha']);
    assert.equal(dry.code, EXIT.ok, dry.stderr.join('\n'));
    assert.deepEqual(
      actsOf(kit).map((act) => act['command']),
      ['add'],
    );
  });

  it('logs nothing for a run with no team', async () => {
    const kit = new CliHarness(null, null);
    await kit.run(ADD);
    assert.equal(kit.files.get(ACTS), undefined);
  });

  it("names each exit teamrig gives, and reads a child's own exit it does not name as failed", () => {
    assert.deepEqual(
      [EXIT.ok, EXIT.refused, EXIT.usage, EXIT.printed, EXIT.ask, EXIT.waiting, EXIT.failed, 7, 255].map(outcomeOf),
      ['ok', 'refused', 'usage', 'printed', 'ask', 'waiting', 'failed', 'failed', 'failed'],
    );
  });

  it("keeps the command's exit when the log cannot be written, and says so", async () => {
    const kit = new CliHarness();
    const files = new FaultyFiles(kit.files).fail('append', ACTS, systemError('EACCES')).fail('write', ACTS, systemError('EACCES'));
    const added = await kit.run(ADD, { files });
    assert.equal(added.code, EXIT.ok);
    assert.ok(added.stderr.some((line) => line.startsWith(`${ACT_NOT_LOGGED} `)));
  });
});
