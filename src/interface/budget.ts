import { MS_PER_WEEK } from '../core/time.ts';
import type { ServedWeek } from './sessions.ts';

/** Where the W per percent comes from (`RateSource`, src/budget/week.ts). */
export type BudgetRateSource = 'learned' | 'limit' | 'estimate';

/** The week against the pace line (`PaceState`, src/budget/pace.ts). */
export type BudgetPaceState = 'ahead' | 'behind' | 'on pace';

/** Where the week's use heads by its reset at the last day's rise, as `teamrig budget` forecasts it. */
export interface ServedWeekForecast {
  /** The use at the reset at that rise, in percent of the week; past 100 when it reaches 100% first. */
  readonly endPct: number;
  /** When it reaches 100% at that rise, ISO in UTC; null when the week ends below it. */
  readonly fullAt: string | null;
}

/** The account's week as the team's budget judges it. Each part is null while it is unknown. */
export interface ServedBudgetWeek {
  /** The week's use, in percent: from the status line, or metered with a known limit. */
  readonly usedPct: number | null;
  /** Where the week's use counts from, ISO in UTC: the weekly reset, or a reset inside the week. */
  readonly start: string | null;
  readonly reset: string | null;
  /** Where the pace line reaches the target; the hours after it are the reserve's. */
  readonly paceEnd: string | null;
  /** How far `at` is from `start` to `reset`, in percent. */
  readonly elapsedPct: number | null;
  /** Where the pace line stands now, in percent of the week. */
  readonly paceLinePct: number | null;
  /** The use minus the line, in points: positive is ahead of it. */
  readonly gapPts: number | null;
  readonly state: BudgetPaceState | null;
  /** Where the W per percent comes from: `learned` from the meter log, the configured `limit`, or an `estimate`. */
  readonly rateFrom: BudgetRateSource | null;
  /** The meter's counts reach back to the week's start, so the week's W is whole. */
  readonly covered: boolean;
  /** When the status line reading was taken, ISO in UTC; null when the use is metered or unknown. */
  readonly statusAt: string | null;
  readonly forecast: ServedWeekForecast | null;
}

/** Today against the team's allowance, in percent of the week. */
export interface ServedBudgetToday {
  /** What the pace line plans for today. */
  readonly plannedPct: number | null;
  /** The team's allowance for today; below `plannedPct` it is a short day. */
  readonly allowancePct: number | null;
  /** Everyone's use today inside the week: the team's sessions and the use outside it. */
  readonly usedPct: number | null;
  /** Its in-day pace. */
  readonly pacePct: number | null;
  /** At or past 100% of the week, which sets the allowance behind that pace. */
  readonly pastLimit: boolean;
}

/** A work class's spend, in percent of the week, as `teamrig budget` lists it. */
export interface ServedClass {
  /** The class; null for the spend on no task. */
  readonly name: string | null;
  /** Today's spend; null while the week's rate is unknown. */
  readonly todayPct: number | null;
  /** The week's spend; null while the week's start or rate is unknown. */
  readonly weekPct: number | null;
  /** Its share in `focus.allocation`; null when it has none. */
  readonly sharePct: number | null;
  /** Its week spend reached its share, so the WIP rule holds its tasks until the week resets. */
  readonly held: boolean;
}

/** The account's five-hour window, from the newest status line reading of it. */
export interface ServedFiveHour {
  readonly usedPct: number;
  readonly resetsAt: string;
  /** When it was read, ISO in UTC. */
  readonly at: string;
  /** Its rise, once its readings span long enough to read one; null before. */
  readonly ptsPerHour: number | null;
  /** When it reaches 100% at that rise, before its reset; null when it resets first. */
  readonly fullAt: string | null;
  /** At `budget.fiveHourWarnPct`, or rising to fill before its reset: what `check` tells the lead. */
  readonly warn: boolean;
}

/** One team of the tree: its own part of the week, and its tasks. */
export interface ServedBudgetTeam {
  readonly team: string;
  /** Its part of the account's week, as its budget hooks last wrote it (as `sessions` serves it); null when none can be read. */
  readonly week: ServedWeek | null;
  /** How far `at` is through that week, in percent; null with `week`. */
  readonly elapsedPct: number | null;
  /** Its tasks not done or dropped. */
  readonly active: number;
  /** Its tasks done since that week's start (the last seven days when no week can be read). */
  readonly finishedThisWeek: number;
}

/** The `budget` document's own fields. */
export interface BudgetBody {
  /** When it was judged, ISO in UTC. */
  readonly at: string;
  /**
   * The first moment after `at` an answer here may change with no file moving: the end of the team's day, the
   * week's reset, the five-hour window's, a forecast reaching 100%. The revision covers files and never the clock.
   */
  readonly validUntil: string;
  /** `budget.enabled`: with it off, every part is null. */
  readonly enabled: boolean;
  readonly week: ServedBudgetWeek | null;
  readonly today: ServedBudgetToday | null;
  /** Empty with the budget off. */
  readonly classes: readonly ServedClass[];
  /** Null with the budget off, or with no window read. */
  readonly fiveHour: ServedFiveHour | null;
  /** Every team of the tree, the root first, numbers only. */
  readonly teams: readonly ServedBudgetTeam[];
}

/**
 * What the document takes of the week's reading (`WeekReading`, src/budget/week.ts, which fits it as it is). The
 * budget's own files are not imported: what they import reads the disk, which this folder may not.
 */
export interface BudgetWeekInput {
  readonly reset: number | undefined;
  readonly window: { readonly start: number; readonly reset: number; readonly paceEnd: number } | undefined;
  readonly usedPct: number | undefined;
  readonly statusAt: number | undefined;
  readonly wPerPct: number | undefined;
  readonly todayWPerPct: number | undefined;
  readonly rateFrom: BudgetRateSource | undefined;
  readonly covered: boolean;
  readonly pace: { readonly linePct: number; readonly gapPts: number; readonly state: BudgetPaceState } | undefined;
  readonly allowancePct: number | undefined;
  readonly plannedPct: number | undefined;
  readonly teamDay: { readonly usedPct: number; readonly pacePct: number; readonly pastLimit?: unknown } | undefined;
  readonly forecast: { readonly endPct: number; readonly fullAt: number | undefined } | undefined;
}

/** A class's spend in W (`ClassRow`, src/budget/class-spend.ts). */
export interface BudgetClassInput {
  readonly name: string;
  readonly todayW: number;
  readonly weekW: number | undefined;
  readonly allocationPct: number | undefined;
}

/** The account's five-hour window as `teamrig budget` and `check` judge it (`FiveHourFold`, its forecast, `fiveHourWarns`). */
export interface FiveHourInput {
  readonly fold: { readonly usedPct: number; readonly resetsAt: number; readonly at: number };
  readonly forecast: { readonly ptsPerHour: number; readonly fullAt: number | undefined } | undefined;
  readonly warn: boolean;
}

/** One team of the tree as the document counts it. */
export interface BudgetTeamInput {
  readonly team: string;
  readonly week: ServedWeek | null;
  readonly active: number;
  readonly finishedThisWeek: number;
}

/** What the `budget` document is built from: the readings `teamrig budget` makes, with the budget on. */
export interface BudgetInput {
  readonly enabled: boolean;
  /** The week as the team's budget reads it; undefined with the budget off. */
  readonly week: BudgetWeekInput | undefined;
  readonly classes: readonly BudgetClassInput[];
  /** The classes the WIP rule holds (`spentClassesOf`). */
  readonly held: ReadonlySet<string>;
  readonly fiveHour: FiveHourInput | undefined;
  readonly teams: readonly BudgetTeamInput[];
  readonly now: number;
  /** The end of the team's day, in ms: today's numbers start over then. */
  readonly dayEnd: number;
  /** The name `classRowsOf` gives the spend on no task, served as a null name. */
  readonly noTaskRow: string;
}

const iso = (at: number | undefined): string | null => (at === undefined ? null : new Date(at).toISOString());

/** How far `now` is from `start` to `end`, in percent, held to 0..100; undefined for an empty span. */
function elapsedOf(start: number, end: number, now: number): number | undefined {
  return end > start ? Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100)) : undefined;
}

/**
 * The `budget` document's body: the numbers `teamrig budget` prints, from the readings it makes and under their own
 * names, so a display tool draws them without parsing its text. A percent is of the account's week throughout. With
 * the budget off only the tree's team counts are served.
 */
export function budgetBody(input: BudgetInput): BudgetBody {
  const { week, now } = input;
  const on = input.enabled && week !== undefined;
  const turns = [input.dayEnd, ...(on ? [week.reset, week.window?.reset, week.forecast?.fullAt] : []), ...(on && input.fiveHour !== undefined ? [input.fiveHour.fold.resetsAt, input.fiveHour.forecast?.fullAt] : [])];
  const after = turns.filter((at): at is number => at !== undefined && Number.isFinite(at) && at > now);
  return {
    at: new Date(now).toISOString(),
    validUntil: new Date(after.length === 0 ? now : Math.min(...after)).toISOString(),
    enabled: input.enabled,
    week: on ? servedBudgetWeek(week, now) : null,
    today: on ? servedToday(week) : null,
    classes: on ? input.classes.map((row) => servedClass(row, week, input)) : [],
    fiveHour: on && input.fiveHour !== undefined ? servedFiveHour(input.fiveHour) : null,
    teams: input.teams.map((team) => servedTeam(team, now)),
  };
}

function servedBudgetWeek(week: BudgetWeekInput, now: number): ServedBudgetWeek {
  const { window, pace, forecast } = week;
  return {
    usedPct: week.usedPct ?? null,
    start: iso(window?.start),
    reset: iso(window?.reset ?? week.reset),
    paceEnd: iso(window?.paceEnd),
    elapsedPct: window === undefined ? null : (elapsedOf(window.start, window.reset, now) ?? null),
    paceLinePct: pace?.linePct ?? null,
    gapPts: pace?.gapPts ?? null,
    state: pace?.state ?? null,
    rateFrom: week.rateFrom ?? null,
    covered: week.covered,
    statusAt: iso(week.statusAt),
    forecast: forecast === undefined ? null : { endPct: forecast.endPct, fullAt: iso(forecast.fullAt) },
  };
}

function servedToday(week: BudgetWeekInput): ServedBudgetToday {
  return {
    plannedPct: week.plannedPct ?? null,
    allowancePct: week.allowancePct ?? null,
    usedPct: week.teamDay?.usedPct ?? null,
    pacePct: week.teamDay?.pacePct ?? null,
    pastLimit: week.teamDay?.pastLimit !== undefined,
  };
}

function servedClass(row: BudgetClassInput, week: BudgetWeekInput, input: BudgetInput): ServedClass {
  const noTask = row.name === input.noTaskRow;
  return {
    name: noTask ? null : row.name,
    todayPct: week.todayWPerPct === undefined ? null : row.todayW / week.todayWPerPct,
    weekPct: row.weekW === undefined || week.wPerPct === undefined ? null : row.weekW / week.wPerPct,
    sharePct: row.allocationPct ?? null,
    held: !noTask && input.held.has(row.name),
  };
}

function servedFiveHour({ fold, forecast, warn }: FiveHourInput): ServedFiveHour {
  return {
    usedPct: fold.usedPct,
    resetsAt: new Date(fold.resetsAt).toISOString(),
    at: new Date(fold.at).toISOString(),
    ptsPerHour: forecast?.ptsPerHour ?? null,
    fullAt: iso(forecast?.fullAt),
    warn,
  };
}

function servedTeam(team: BudgetTeamInput, now: number): ServedBudgetTeam {
  const { week } = team;
  const reset = week === null ? undefined : Date.parse(week.resetsAt);
  const start = week === null || reset === undefined ? undefined : week.start === null ? reset - MS_PER_WEEK : Date.parse(week.start);
  return {
    team: team.team,
    week,
    elapsedPct: start === undefined || reset === undefined ? null : (elapsedOf(start, reset, now) ?? null),
    active: team.active,
    finishedThisWeek: team.finishedThisWeek,
  };
}
