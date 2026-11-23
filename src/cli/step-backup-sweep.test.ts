import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { MS_PER_DAY } from '../core/time.ts';
import { toJsonlLine } from '../core/jsonl.ts';
import { CliHarness, TEAM, TEAM_HOME } from '../testing/cli-harness.ts';
import { EXIT } from './runtime.ts';
import { backupDue } from './step-backup-sweep.ts';

const NOW = Date.parse('2030-01-08T10:00:00Z');
const BACKUPS = join(TEAM_HOME, 'backups');
const LEDGER = join(TEAM_HOME, 'state', 'step-backups.jsonl');
const OLD = join(BACKUPS, 'config.v3.json');
const FRESH = join(BACKUPS, 'config.v4.json');
const UNDATED = join(BACKUPS, 'config.v5.json');
const OWN = join(BACKUPS, 'my-own-copy.json');

function stampDaysAgo(days: number): string {
  return new Date(NOW - days * MS_PER_DAY).toISOString();
}

/** A team whose ledger records an 8-day-old, a 6-day-old and an undated backup, beside a file the person made. */
async function teamWithBackups(team = TEAM): Promise<CliHarness> {
  const kit = new CliHarness(team);
  const rows = [
    { v: 1, step: 'config-format', path: OLD, at: stampDaysAgo(8) },
    { v: 1, step: 'config-format', path: FRESH, at: stampDaysAgo(6) },
    { v: 1, step: 'config-format', path: UNDATED, at: 'not a stamp' },
  ];
  await kit.files.write(LEDGER, rows.map(toJsonlLine).join(''));
  await Promise.all([OLD, FRESH, UNDATED, OWN].map((path) => kit.files.write(path, '{}')));
  return kit;
}

describe('backupDue', () => {
  it('is due only past its days, and never for a stamp it cannot read', () => {
    const backup = { step: 'config-format', path: OLD, at: stampDaysAgo(7) };
    assert.equal(backupDue(backup, NOW, 7), false);
    assert.equal(backupDue(backup, NOW + 1, 7), true);
    assert.equal(backupDue({ ...backup, at: 'yesterday' }, NOW, 0), false);
  });
});

describe("the lead's start removes the step backups kept past steps.backupDays", () => {
  it('removes only the recorded backups past the default 7 days, with a count line first', async () => {
    const kit = await teamWithBackups();
    const started = await kit.run(['start', '--session', 'lead']);
    assert.equal(started.code, EXIT.ok, started.stdout.join('\n'));
    const at = started.stdout.findIndex((line) => line.startsWith('CLEANED'));
    assert.deepEqual(started.stdout.slice(at, at + 2), ['CLEANED 1 step backup(s) older than 7 days [steps.backupDays]', `  ${OLD}`]);
    assert.deepEqual([OLD, FRESH, UNDATED, OWN].map((path) => kit.files.get(path) !== undefined), [false, true, true, true]);
    assert.doesNotMatch(kit.files.get(LEDGER) ?? '', /config\.v3/);

    const again = await kit.run(['start', '--session', 'lead']);
    assert.ok(!again.stdout.some((line) => line.startsWith('CLEANED')), again.stdout.join('\n'));
  });

  it('reads the days from the team config', async () => {
    const kit = await teamWithBackups({ ...TEAM, steps: { backupDays: 5 } });
    const started = await kit.run(['start', '--session', 'lead']);
    assert.ok(started.stdout.includes('CLEANED 2 step backup(s) older than 5 days [steps.backupDays]'), started.stdout.join('\n'));
    assert.deepEqual([OLD, FRESH, UNDATED].map((path) => kit.files.get(path) !== undefined), [false, false, true]);
  });

  it('leaves a due row naming a file outside the backups folder, warns and drops the row', async () => {
    const kit = await teamWithBackups();
    const outside = join(TEAM_HOME, 'state', 'config.v2.json');
    await kit.files.write(outside, '{}');
    await kit.files.append(LEDGER, toJsonlLine({ v: 1, step: 'config-format', path: outside, at: stampDaysAgo(9) }));
    const started = await kit.run(['start', '--session', 'lead']);
    assert.equal(started.code, EXIT.ok, started.stdout.join('\n'));
    assert.ok(
      started.stderr.includes(`WARN the step backup ledger named ${outside}, which is not a step backup in the backups folder; left it and dropped its row`),
      started.stderr.join('\n'),
    );
    assert.ok(started.stdout.includes('CLEANED 1 step backup(s) older than 7 days [steps.backupDays]'), started.stdout.join('\n'));
    assert.equal(kit.files.get(outside), '{}');
    assert.doesNotMatch(kit.files.get(LEDGER) ?? '', /config\.v2/);
  });

  it("leaves every backup at another session's start", async () => {
    const kit = await teamWithBackups();
    const started = await kit.run(['start', '--session', 'alpha']);
    assert.equal(started.code, EXIT.ok, started.stdout.join('\n'));
    assert.ok(!started.stdout.some((line) => line.startsWith('CLEANED')), started.stdout.join('\n'));
    assert.equal(kit.files.get(OLD), '{}');
  });
});
