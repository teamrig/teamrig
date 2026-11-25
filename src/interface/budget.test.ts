import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calibrationOf } from '../budget/calibration.ts';
import { NO_TASK_ROW, type ClassRow } from '../budget/class-spend.ts';
import { fiveHourForecast } from '../budget/five-hour-forecast.ts';
import { weekWindow } from '../budget/pace.ts';
import type { WeekReading } from '../budget/week.ts';
import { MS_PER_HOUR, MS_PER_WEEK } from '../core/time.ts';
import { budgetBody, type BudgetInput } from './budget.ts';

const RESET = Date.parse('2026-10-21T01:00:00Z');
const WINDOW = weekWindow(RESET, 1);
const NOW = Date.parse('2026-10-15T11:00:00Z');
const DAY_END = Date.parse('2026-10-16T00:00:00Z');

/** 57% used at 11:00, 1% of the week = 7.5M W, a 10.25% allowance today, everyone's 5.16% today. */
const WEEK: WeekReading = {
  reset: RESET,
  window: WINDOW,
  periodKind: 'week',
  usedPct: 57,
  statusAt: NOW,
  wPerPct: 7_500_000,
  rateFrom: 'learned',
  calibration: calibrationOf([]),
  covered: true,
  pace: { window: WINDOW, linePct: 20.5, gapPts: 36.5, state: 'ahead' },
  allowancePct: 10.25,
  plannedPct: 14.3,
  todayFrom: Date.parse('2026-10-15T00:00:00Z'),
  todayW: 38_700_000,
  todayWPerPct: 5_000_000,
  usedWPerPct: 7_500_000,
  teamDay: { usedPct: 5.16, pacePct: 4.7 },
  pool: undefined,
  forecast: { risePts: 12, endPct: 121, fullAt: Date.parse('2026-10-18T09:00:00Z') },
};

const CLASSES: ClassRow[] = [
  { name: 'Roadmap', todayW: 10_000_000, weekW: 300_000_000, allocationPct: 60 },
  { name: 'Improvements', todayW: 5_000_000, weekW: 150_000_000, allocationPct: 20 },
  { name: NO_TASK_ROW, todayW: 1_000_000, weekW: undefined, allocationPct: undefined },
];

/** 30 points an hour from 10% an hour ago: full two hours on, an hour before its reset. */
const FOLD = { resetsAt: NOW + 3 * MS_PER_HOUR, usedPct: 40, at: NOW, firstPct: 10, firstAt: NOW - MS_PER_HOUR };

function input(overrides: Partial<BudgetInput> = {}): BudgetInput {
  return {
    enabled: true,
    week: WEEK,
    classes: CLASSES,
    held: new Set(['Improvements']),
    fiveHour: { fold: FOLD, forecast: fiveHourForecast(FOLD), warn: true },
    teams: [],
    now: NOW,
    dayEnd: DAY_END,
    noTaskRow: NO_TASK_ROW,
    ...overrides,
  };
}

describe('budgetBody', () => {
  it("serves the week, today and its pace as teamrig budget reads them, each instant in UTC", () => {
    const body = budgetBody(input());
    assert.deepEqual(body.week, {
      usedPct: 57,
      start: new Date(WINDOW.start).toISOString(),
      reset: '2026-10-21T01:00:00.000Z',
      paceEnd: new Date(WINDOW.paceEnd).toISOString(),
      elapsedPct: ((NOW - WINDOW.start) / (RESET - WINDOW.start)) * 100,
      paceLinePct: 20.5,
      gapPts: 36.5,
      state: 'ahead',
      rateFrom: 'learned',
      covered: true,
      statusAt: '2026-10-15T11:00:00.000Z',
      forecast: { endPct: 121, fullAt: '2026-10-18T09:00:00.000Z' },
    });
    assert.deepEqual(body.today, { plannedPct: 14.3, allowancePct: 10.25, usedPct: 5.16, pacePct: 4.7, pastLimit: false });
    assert.equal(body.enabled, true);
  });

  it('serves each class in percent of the week, today at its own rate, the spend on no task with a null name', () => {
    assert.deepEqual(budgetBody(input()).classes, [
      { name: 'Roadmap', todayPct: 2, weekPct: 40, sharePct: 60, held: false },
      { name: 'Improvements', todayPct: 1, weekPct: 20, sharePct: 20, held: true },
      { name: null, todayPct: 0.2, weekPct: null, sharePct: null, held: false },
    ]);
  });

  it('serves the five-hour window with its rise, when it fills, and whether it warns', () => {
    assert.deepEqual(budgetBody(input()).fiveHour, {
      usedPct: 40,
      resetsAt: new Date(FOLD.resetsAt).toISOString(),
      at: '2026-10-15T11:00:00.000Z',
      ptsPerHour: 30,
      fullAt: new Date(NOW + 2 * MS_PER_HOUR).toISOString(),
      warn: true,
    });
  });

  it('holds until the nearest of the day end, the resets and the moments a forecast fills', () => {
    assert.equal(budgetBody(input()).validUntil, new Date(NOW + 2 * MS_PER_HOUR).toISOString());
    assert.equal(budgetBody(input({ fiveHour: undefined })).validUntil, '2026-10-16T00:00:00.000Z');
  });

  it('serves every part null with the budget off, the tree kept, held to the day end', () => {
    const teams = [{ team: 'root', week: null, active: 3, finishedThisWeek: 2 }];
    const body = budgetBody(input({ enabled: false, week: undefined, teams }));
    assert.deepEqual(
      { week: body.week, today: body.today, classes: body.classes, fiveHour: body.fiveHour, validUntil: body.validUntil },
      { week: null, today: null, classes: [], fiveHour: null, validUntil: '2026-10-16T00:00:00.000Z' },
    );
    assert.deepEqual(body.teams, [{ team: 'root', week: null, elapsedPct: null, active: 3, finishedThisWeek: 2 }]);
  });

  it('serves an unmeasured week with null numbers and no forecast', () => {
    const unknown: WeekReading = { ...WEEK, window: undefined, reset: undefined, usedPct: undefined, wPerPct: undefined, todayWPerPct: undefined, pace: undefined, allowancePct: undefined, plannedPct: undefined, teamDay: undefined, forecast: undefined, rateFrom: undefined, statusAt: undefined };
    const body = budgetBody(input({ week: unknown, fiveHour: undefined }));
    assert.deepEqual(body.week?.usedPct, null);
    assert.deepEqual(body.week?.elapsedPct, null);
    assert.deepEqual(body.today, { plannedPct: null, allowancePct: null, usedPct: null, pacePct: null, pastLimit: false });
    assert.deepEqual(body.classes[0], { name: 'Roadmap', todayPct: null, weekPct: null, sharePct: 60, held: false });
  });

  it("serves each tree team's week as its hooks wrote it and how far through it the answer is, from the last reset when no start is named", () => {
    const resetsAt = new Date(NOW + MS_PER_WEEK / 4).toISOString();
    const week = { usedPct: 10, plannedPct: 30, accountUsedPct: 57, resetsAt, start: null, at: '2026-10-15T10:55:00.000Z' };
    const [team] = budgetBody(input({ teams: [{ team: 'web', week, active: 5, finishedThisWeek: 7 }] })).teams;
    assert.deepEqual(team, { team: 'web', week, elapsedPct: 75, active: 5, finishedThisWeek: 7 });
  });
});
