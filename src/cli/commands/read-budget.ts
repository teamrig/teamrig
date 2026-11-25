import { classRowsOf, NO_TASK_ROW, spentClassesOf } from '../../budget/class-spend.ts';
import { fiveHourForecast, fiveHourWarns } from '../../budget/five-hour-forecast.ts';
import { readFolderFiveHour } from '../../budget/five-hour-summary.ts';
import { OUTSIDE_ID, outsideUsageDir } from '../../budget/measure.ts';
import { snapshotDirOf } from '../../budget/snapshot.ts';
import { peekTeamWeekOf } from '../../budget/team-week.ts';
import { MS_PER_WEEK } from '../../core/time.ts';
import { budgetBody, type BudgetTeamInput, type FiveHourInput } from '../../interface/index.ts';
import { layoutPaths } from '../../register/layout.ts';
import { dayEndOf, isActive } from '../../register/stats.ts';
import { accountWeekOn } from '../account-teams.ts';
import { teamZone } from '../kit.ts';
import type { CliRuntime } from '../runtime.ts';
import { readStoredUsage, peerUsageOf } from '../stored-week.ts';
import { teamsFolderOf, type TreeTeam } from '../tree.ts';
import { folderStampsOf, foldersStampsOf, registerStampsOf } from './read-plan.ts';
import { servedWeekOf, treeTeamsOf } from './read-sessions.ts';
import { once, stampsOf, workingSetOf, type DocumentSource, type ReadScope } from './read-source.ts';

/**
 * `budget`: the team's budget as `teamrig budget` judges it, as numbers. The week is read in the account's week files
 * (`accountWeekOn`) the way the budget hooks read it, from each session's use as last stored and the other teams'
 * on the account, never from a transcript: `teamrig budget` measures the transcripts first, so this answer is as of
 * the last hook's measure, and a read writes nothing (`peekTeamWeekOf` leaves the period and the meter log as they
 * are). The classes and their holds count the team's sessions alone, as `teamrig budget`'s rows do; the five-hour
 * window is the status line's, judged as `check` judges it. Every team of the tree is served with its week file (as
 * `sessions` serves it) and its counts of active tasks and tasks done since that week's start.
 *
 * Its revision covers those files by their stamps, never the clock; `validUntil` tells a reader when to ask again
 * with no file moved. With the budget off only the tree's teams are read.
 */
export function budgetSource(scope: ReadScope): DocumentSource {
  const { runtime, kit, config } = scope;
  const account = once(async () => accountWeekOn(runtime, config.budget, kit.paths, runtime.clock.now()));
  return {
    async parts() {
      const loaded = await scope.tree();
      const all = [...loaded.teams.values()];
      const configs = [...all.map((other) => other.kit.load.path), ...[...loaded.leftOut.values()].map((load) => load.path)];
      const teams = treeTeamsOf(loaded, kit.paths.team);
      const budget: (string | null)[] = [];
      if (config.budget.enabled) {
        const { paths, peers } = await account();
        // Every team's status line folder: the account's newest reading may sit in any of them.
        const snapshots = [...new Set(all.map((other) => snapshotDirOf(other.config.budget, other.kit.paths)))].sort();
        budget.push(
          ...(await foldersStampsOf(runtime, [kit.paths.usage, outsideUsageDir(kit.paths.usage), ...peers.map((peer) => peer.usage), ...snapshots])),
          ...(await stampsOf(runtime, [paths.period, paths.meterLog, paths.extraLog])),
        );
      }
      return {
        document: 'budget',
        args: [['team', kit.paths.team]],
        stamps: [
          // A team folder added or removed moves no file the tree read: the folder's own listing tells.
          (await runtime.files.list(teamsFolderOf(runtime))).join(','),
          ...(await stampsOf(runtime, configs)),
          ...(await registerStampsOf(runtime, teams)),
          ...(await stampsOf(runtime, teams.map((other) => other.kit.paths.teamWeek))),
          ...budget,
        ],
      };
    },
    async build() {
      const now = runtime.clock.now();
      const loaded = await scope.tree();
      const counted = await Promise.all(treeTeamsOf(loaded, kit.paths.team).map((team) => teamCountsOf(runtime, team, now)));
      const teams = counted.map((each) => each.team);
      const problems = counted.flatMap((each) => each.problems);
      const dayEnd = dayEndOf(new Date(now), teamZone(config, runtime));
      const off = { enabled: false, week: undefined, classes: [], held: new Set<string>(), fiveHour: undefined, teams, now, dayEnd, noTaskRow: NO_TASK_ROW };
      if (!config.budget.enabled) {
        return { body: budgetBody(off), problems };
      }
      const { budget, focus } = config;
      const onAccount = await account();
      const usage = await readStoredUsage(runtime, kit.paths, config.sessions);
      const peerStates = (await peerUsageOf(runtime, onAccount.peers)).flatMap((peer) => peer.states);
      const week = await peekTeamWeekOf(runtime.files, onAccount, { budget, now, statusUse: onAccount.statusUse, states: [...usage.values(), ...peerStates] });
      // The team's sessions alone, as `teamrig budget`'s rows and the WIP rule's holds count them.
      usage.delete(OUTSIDE_ID);
      const states = [...usage.values()];
      const register = await workingSetOf(runtime, kit.paths, layoutPaths(kit.paths.events));
      const tasks = [...register.tasks.values()];
      const classes = classRowsOf({ states, tasks, focus, todayFrom: week.todayFrom, weekFrom: week.window?.start, now });
      const held = week.window === undefined || week.wPerPct === undefined ? new Set<string>() : spentClassesOf({ states, tasks, focus, weekFrom: week.window.start, wPerPct: week.wPerPct, now });
      const fold = await readFolderFiveHour(runtime.files, snapshotDirOf(budget, kit.paths), now);
      const forecast = fold === undefined ? undefined : fiveHourForecast(fold);
      const fiveHour: FiveHourInput | undefined = fold === undefined ? undefined : { fold, forecast, warn: fiveHourWarns(fold, forecast, budget) };
      return { body: budgetBody({ ...off, enabled: true, week, classes, held, fiveHour }), problems: [...problems, ...register.problems] };
    },
  };
}

/**
 * One tree team's week file as `sessions` serves it, and its register's counts: its tasks not done or dropped, and
 * those done since its week's start (the last reset when the file names no start; the last seven days with no file).
 */
async function teamCountsOf(runtime: CliRuntime, { kit }: TreeTeam, now: number): Promise<{ readonly team: BudgetTeamInput; readonly problems: readonly string[] }> {
  const week = servedWeekOf(await runtime.files.read(kit.paths.teamWeek));
  const start = week === null ? now - MS_PER_WEEK : week.start === null ? Date.parse(week.resetsAt) - MS_PER_WEEK : Date.parse(week.start);
  const register = await workingSetOf(runtime, kit.paths, layoutPaths(kit.paths.events));
  const tasks = [...register.tasks.values()];
  return {
    team: {
      team: kit.paths.team,
      week,
      active: tasks.filter((task) => isActive(task.status)).length,
      finishedThisWeek: tasks.filter((task) => task.status === 'done' && Date.parse(task.statusAt) >= start).length,
    },
    problems: register.problems,
  };
}
