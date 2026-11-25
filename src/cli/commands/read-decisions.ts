import { formatAddress } from '../../core/address.ts';
import { SecretScanner } from '../../core/secrets.ts';
import { waitsOfTeams, type DecisionBatch, type OwnerWait } from '../../decisions/batch.ts';
import { decisionsBody } from '../../interface/index.ts';
import { layoutPaths } from '../../register/layout.ts';
import { NO_TASKS_ELSEWHERE } from '../../register/tree.ts';
import { ownerBatchOf } from '../owner-batch.ts';
import { teamRanking } from '../team-ranking.ts';
import { elsewhereOf, planStampsOf } from './read-plan.ts';
import { stampsOf, workingSetOf, type DocumentSource, type ReadScope } from './read-source.ts';

/**
 * `decisions`: the owner's batch that holds the team's waits on the owner, as `teamrig decisions` reads it: for a
 * root team its own register and every register under it, for a team under the root only its own and its teams'
 * waits of the root's batch. It reads what the plan reads (the batch asks each register's waits in plan order) and
 * every tree team's record of the batches its lead asked and its meetings, which say which waits were asked.
 *
 * Its revision covers those files by their stamps, never the clock; `validUntil` tells a reader when to ask again
 * with no file moved. `--owner` serves only that session's waits, in the same groups and order.
 */
export function decisionsSource(scope: ReadScope): DocumentSource {
  const { runtime, kit, config } = scope;
  const team = kit.paths.team;
  return {
    async parts() {
      const loaded = await scope.tree();
      const kept = [...loaded.teams.values()].map((other) => other.kit.paths);
      return {
        document: 'decisions',
        args: [
          ['team', team],
          ['owner', scope.owner],
        ],
        stamps: [...(await planStampsOf(scope)), ...(await stampsOf(runtime, kept.flatMap((paths) => [paths.decisionsAsked, paths.meeting])))],
      };
    },
    async build() {
      const now = runtime.clock.now();
      const register = await workingSetOf(runtime, kit.paths, layoutPaths(kit.paths.events));
      const loaded = await scope.tree();
      const elsewhere = await elsewhereOf(runtime, loaded, team);
      const ranking = await teamRanking(runtime, kit.paths, config, register.tasks.values());
      // Judged without the tree's other registers, a wait could be served as freeing a task whose need there is open: none is served then.
      const tasks = elsewhere.tasks === null ? new Map() : register.tasks;
      const own = { team, config, paths: kit.paths, tasks, elsewhere: elsewhere.tasks ?? NO_TASKS_ELSEWHERE, ranking };
      const { batch, askedBy } = await ownerBatchOf(runtime, own, loaded, now);
      const held = askedBy === undefined ? batch : waitsOfTeams(batch, [team, ...loaded.tree.descendantsOf(team)]);
      const body = decisionsBody({
        batch: scope.owner === null ? held : ofOwner(held, scope.owner),
        askedBy: askedBy === undefined ? null : formatAddress(askedBy),
        now,
        shapes: new SecretScanner(config.register.secretPatterns),
      });
      return { body, problems: [...register.problems, ...(elsewhere.problem === null ? [] : [elsewhere.problem])] };
    },
  };
}

/** The batch's waits of session `owner` alone, its trigger and times kept: `--owner` filters what is served, nothing else. */
function ofOwner(batch: DecisionBatch, owner: string): DecisionBatch {
  const mine = (waits: readonly OwnerWait[]): OwnerWait[] => waits.filter((wait) => wait.task.owner === owner);
  return { ...batch, pending: mine(batch.pending), overdue: mine(batch.overdue), weekly: mine(batch.weekly), dedicated: mine(batch.dedicated), later: mine(batch.later) };
}
