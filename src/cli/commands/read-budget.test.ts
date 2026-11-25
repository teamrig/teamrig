import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { formatTeamWeek } from '../../budget/team-week-summary.ts';
import { formatConfig } from '../../config/load.ts';
import type { JsonRecord } from '../../core/guards.ts';
import { MS_PER_DAY, MS_PER_HOUR } from '../../core/time.ts';
import { INTERFACE_VERSION } from '../../interface/index.ts';
import { APP, CliHarness, TEAM, type RunOptions } from '../../testing/cli-harness.ts';
import { rowsOf, served } from '../../testing/read-answers.ts';
import { SUB_TEAMS, teamConfigOf, teamHomeOf, treeHarness } from '../../testing/team-tree.ts';
import { EXIT } from '../runtime.ts';

const READ_BUDGET = ['read', 'budget', '--json'] as const;
const BUDGET_ON: JsonRecord = { ...TEAM, budget: { enabled: true, weeklyLimitW: 1_000_000_000 } };
const RESET = Date.parse('2030-01-14T01:00:00Z');

/** A status line's input with the account's week and five-hour readings. */
function statusInput(weekPct: number, fiveHourPct: number, fiveHourResetsAt: number): string {
  return JSON.stringify({
    session_id: '0000000a-0000-4000-8000-000000000001',
    cwd: APP,
    rate_limits: { five_hour: { used_percentage: fiveHourPct, resets_at: fiveHourResetsAt / 1000 }, seven_day: { used_percentage: weekPct, resets_at: RESET / 1000 } },
  });
}

async function ok(kit: CliHarness, argv: readonly string[], options: RunOptions = {}): Promise<readonly string[]> {
  const result = await kit.run(argv, options);
  assert.equal(result.code, EXIT.ok, [...argv, ...result.stdout, ...result.stderr].join(' '));
  return result.stdout;
}

async function add(kit: CliHarness, title: string, owner: string, options: RunOptions = {}): Promise<void> {
  await ok(kit, ['add', '--session', 'lead', '--title', title, '--description', 'what and why', '--owner', owner, '--priority', 'p2'], options);
}

const teamsOf = (answer: JsonRecord): JsonRecord[] => rowsOf(answer, 'teams');

describe('read budget', () => {
  it("serves every part null with the budget off, and the team's task counts", async () => {
    const kit = new CliHarness();
    await add(kit, 'Ship the page', 'alpha');
    await add(kit, 'Fix the form', 'bravo');
    await ok(kit, ['set', 'T2', '--status', 'done', '--note', 'shipped', '--evidence', 'the page loads', '--skill', 'none', '--followups', 'none', '--session', 'bravo']);
    const answer = served(await kit.run(READ_BUDGET));
    assert.deepEqual([answer['interface'], answer['document'], answer['problems'], answer['enabled']], [INTERFACE_VERSION, 'budget', [], false]);
    assert.match(String(answer['revision']), /^[0-9a-f]{16}$/);
    assert.deepEqual([answer['week'], answer['today'], answer['classes'], answer['fiveHour']], [null, null, [], null]);
    assert.deepEqual(
      teamsOf(answer).map((team) => [team['week'], team['active'], team['finishedThisWeek']]),
      [[null, 1, 1]],
    );
  });

  it('serves the week, today and the classes with the budget on, and answers unchanged on a second read: a read writes nothing', async () => {
    const kit = new CliHarness(BUDGET_ON);
    await add(kit, 'Ship the page', 'alpha');
    const answer = served(await kit.run(READ_BUDGET));
    assert.deepEqual([answer['enabled'], answer['problems'], answer['fiveHour']], [true, [], null]);
    const week = answer['week'] as JsonRecord;
    assert.equal(week['rateFrom'], 'limit');
    assert.deepEqual(Object.keys(week), ['usedPct', 'start', 'reset', 'paceEnd', 'elapsedPct', 'paceLinePct', 'gapPts', 'state', 'rateFrom', 'covered', 'statusAt', 'forecast']);
    assert.ok(answer['today'] !== null);
    // No reset is configured, so the week's start is unknown and no class has a week's spend.
    assert.deepEqual(rowsOf(answer, 'classes').at(-1), { name: null, todayPct: 0, weekPct: null, sharePct: null, held: false });
    const held = String(answer['revision']);
    assert.deepEqual(served(await kit.run([...READ_BUDGET, '--unless', `budget=${held}`])), { interface: INTERFACE_VERSION, document: 'budget', revision: held, unchanged: true });
    await add(kit, 'Fix the form', 'bravo');
    const moved = served(await kit.run([...READ_BUDGET, '--unless', `budget=${held}`]));
    assert.deepEqual([moved['unchanged'], teamsOf(moved)[0]?.['active']], [undefined, 2]);
  });

  it("serves every team of the tree, the root first, each with its own counts", async () => {
    const kit = await treeHarness();
    await add(kit, 'Pick the region', 'back', { env: { TEAMRIG_TEAM: 'web' } });
    const answer = served(await kit.run(READ_BUDGET));
    const teams = teamsOf(answer);
    assert.ok(teams.length >= 2, JSON.stringify(teams));
    const web = teams.find((team) => team['team'] === 'web');
    assert.deepEqual([web?.['active'], teams[0]?.['team'] === 'web'], [1, false]);
  });

  it("serves the status line's week and five-hour window, with each class's hold judged in the week", async () => {
    const kit = new CliHarness(BUDGET_ON);
    await add(kit, 'Ship the page', 'alpha');
    const now = kit.clock.now();
    await ok(kit, ['statusline'], { stdin: statusInput(30, 85, now + 2 * MS_PER_HOUR) });
    const answer = served(await kit.run(READ_BUDGET));
    const week = answer['week'] as JsonRecord;
    assert.deepEqual([week['usedPct'], week['reset'], typeof week['elapsedPct']], [30, new Date(RESET).toISOString(), 'number']);
    const fiveHour = answer['fiveHour'] as JsonRecord;
    assert.deepEqual([fiveHour['usedPct'], fiveHour['resetsAt'], fiveHour['warn']], [85, new Date(now + 2 * MS_PER_HOUR).toISOString(), true]);
    // Nothing is spent yet, so every class with a share is served with it and none is held.
    const shared = rowsOf(answer, 'classes').filter((row) => typeof row['sharePct'] === 'number');
    assert.ok(shared.length > 0 && shared.every((row) => row['held'] === false), JSON.stringify(shared));
    assert.ok(Date.parse(String(answer['validUntil'])) <= now + 2 * MS_PER_HOUR, String(answer['validUntil']));
  });

  it("counts a peer team's stores on the account and serves a tree team's week file with how far through it the answer is", async () => {
    const kit = await treeHarness({ budget: { enabled: true, weeklyLimitW: 1_000_000_000 } });
    await kit.files.write(teamConfigOf('web'), formatConfig({ ...SUB_TEAMS['web'], budget: { enabled: true } }));
    const now = kit.clock.now();
    const start = RESET - 7 * MS_PER_DAY;
    const file = { account: 'default', usedPct: 5, plannedPct: 20, accountUsedPct: 30, resetsAt: RESET, start, startPct: 0, at: now, limits: [] };
    await kit.files.write(join(teamHomeOf('web'), 'state', 'usage', 'team.week.json'), formatTeamWeek(file));
    const answer = served(await kit.run(READ_BUDGET));
    assert.deepEqual(answer['problems'], []);
    const web = teamsOf(answer).find((team) => team['team'] === 'web');
    assert.deepEqual((web?.['week'] as JsonRecord | null)?.['usedPct'], 5);
    assert.equal(web?.['elapsedPct'], ((now - start) / (RESET - start)) * 100);
  });

  it('changes no file: the period, the meter log and every store stay as the status line left them', async () => {
    const kit = new CliHarness(BUDGET_ON);
    await add(kit, 'Ship the page', 'alpha');
    await ok(kit, ['statusline'], { stdin: statusInput(30, 40, kit.clock.now() + 2 * MS_PER_HOUR) });
    const before = new Map(kit.files.paths().map((path) => [path, kit.files.get(path)]));
    served(await kit.run(READ_BUDGET));
    const after = new Map(kit.files.paths().map((path) => [path, kit.files.get(path)]));
    assert.deepEqual([...after.keys()].filter((path) => !before.has(path)), [], 'no file written');
    assert.deepEqual([...after].filter(([path, text]) => before.get(path) !== text).map(([path]) => path), [], 'no file changed');
  });

  it("moves its revision on a new status line reading, and serves the new numbers", async () => {
    const kit = new CliHarness(BUDGET_ON);
    await ok(kit, ['statusline'], { stdin: statusInput(30, 40, kit.clock.now() + 2 * MS_PER_HOUR) });
    const held = String(served(await kit.run(READ_BUDGET))['revision']);
    kit.clock.advance(60_000);
    await ok(kit, ['statusline'], { stdin: statusInput(55, 45, kit.clock.now() + 2 * MS_PER_HOUR) });
    const moved = served(await kit.run([...READ_BUDGET, '--unless', `budget=${held}`]));
    assert.equal(moved['unchanged'], undefined);
    assert.deepEqual([(moved['week'] as JsonRecord)['usedPct'], (moved['fiveHour'] as JsonRecord)['usedPct']], [55, 45]);
  });
});
