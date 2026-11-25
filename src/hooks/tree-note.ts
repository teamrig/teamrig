/**
 * The SessionStart line for a team whose own place in its tree is broken: a parent with no team config here, or a
 * role left to a session that is not its holder on a team above. A home copied or moved to another machine without
 * its parent meets both at once, and until now only `doctor` named them, so the session ran on with waits on the
 * parent's tasks, its budget keys and its rules gone without a word (T5469). Problems of the tree's other teams
 * stay `doctor`'s: they are not this session's to fix.
 */

import { describeTreeProblem, type TeamTree, type TreeProblem } from '../config/tree.ts';

/** The kinds of problem that name one team's own config: a missing parent, a role held by no one above. */
type OwnProblem = Extract<TreeProblem, { readonly kind: 'tree-parent' | 'tree-role' }>;

function isOwnProblemOf(team: string): (problem: TreeProblem) => problem is OwnProblem {
  return (problem): problem is OwnProblem => (problem.kind === 'tree-parent' || problem.kind === 'tree-role') && problem.team === team;
}

/** The line naming each of the team's own tree problems and their fixes; undefined when it has none. */
export function treeNoteOf(tree: TeamTree, team: string, command: string): string | undefined {
  const own = tree.problemsOf(team).filter(isOwnProblemOf(team));
  if (own.length === 0) {
    return undefined;
  }
  const lines = own.map((problem) => describeTreeProblem(problem, command));
  return `This team's place in its tree is broken, so what it takes from the teams above (waits, roles, budget keys, rules) is missing: ${lines.join('; ')}. \`${command} doctor\` lists the tree's problems.`;
}
