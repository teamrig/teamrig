import { KIT_NAME } from '../core/home.ts';
import type { CommandTable } from '../slash/plan.ts';
import { ALLOW_COMMANDS } from './allow-sync.ts';
import { ROUTE_FILTERS, isRouteFilter } from './route-filter.ts';
import { kitCallOf } from './route-kit.ts';
import { routeLineOf } from './route-line.ts';
import { LANDING_COMMANDS } from './route-pr.ts';

/**
 * What a session is told when the host would prompt for one of teamrig's own commands (T5070 S2, T5119): the prompt
 * refusal alone says only to take the next task, which leaves a session guessing why its own `teamrig list` was stopped.
 * A command whose allow rule `automode install` syncs (allow-sync.ts) names that rule and the install that adds it;
 * a command of a narrower sanctioned route names the route's exact form, never a wider rule (security note N2). Any
 * other teamrig command (a write past the team's files, the sync's exclusions, `exec approve`, `queue`, `test`) and any
 * line that is not one plain teamrig command get no hint: their refusal stays as it is.
 */

/**
 * The exact form each narrower route takes (route-kit.ts KIT_SHAPES, route-pr.ts), as a session writes it; specs hold
 * each form to its route's matcher.
 */
export const ROUTE_FORMS: ReadonlyMap<string, string> = new Map([
  ['merge', `${KIT_NAME} merge [--session <id>] [--keep-remote] [--no-delete-local]`],
  ['deploy', `${KIT_NAME} deploy [--session <id>] [--repo <name>]`],
  ['exec request', `${KIT_NAME} exec request --file <request.json> [--session <id>]`],
  ['worktree remove', `${KIT_NAME} worktree remove <path> [--session <id>] [--delete-branch] [--dry-run]`],
  ['pr approve', `${KIT_NAME} pr approve <owner>/<name>#<number> --head <40-hex sha> [--session <id>] [--check]`],
  ['pr merge', `${KIT_NAME} pr merge <owner>/<name>#<number> --head <40-hex sha> [--session <id>] [--check]`],
]);

/** The landing routes match only where `pr` itself checks the leader's approval of that head (route-pr.ts). */
const LANDING_NOTE = ', and only for a head your leader approved, from the tab bound to your session';

/** The host's allow rules for one teamrig command, such as `Bash(teamrig list *)`. */
export type AllowRulesFor = (command: string) => readonly string[];

/** A program word that starts teamrig as written: a bare `teamrig`, or a path whose last part is it. */
function namesKit(program: string): boolean {
  const last = program.slice(Math.max(program.lastIndexOf('/'), program.lastIndexOf('\\')) + 1);
  return last.replace(/\.(?:cmd|exe|ps1)$/iu, '').toLowerCase() === KIT_NAME;
}

/** What a line must also be to run with no prompt: a bare program word, and only a read-only filter after a pipe. */
function shapeNotes(program: string, filter: readonly string[] | undefined): string {
  const notes = [
    ...(program === KIT_NAME ? [] : [`with the program word a bare \`${KIT_NAME}\``]),
    ...(filter === undefined || isRouteFilter(filter) ? [] : [`piped into nothing but one read-only filter (${Object.keys(ROUTE_FILTERS).join(', ')}) with no file`]),
  ];
  return notes.length === 0 ? '' : `, ${notes.join(', ')}`;
}

/**
 * The hint for a prompt on `line`, or undefined when it is no plain teamrig command whose route or synced rule a
 * session can use: the synced command's host rule and the install that adds it, or the route's exact form.
 */
export function routeHintOf(line: string, cli: CommandTable, allowRulesFor: AllowRulesFor): string | undefined {
  const routeLine = routeLineOf(line);
  const call = routeLine === undefined ? undefined : kitCallOf(routeLine.words, cli);
  if (routeLine === undefined || call === undefined || !namesKit(call.program)) {
    return undefined;
  }
  const { command } = call.parsed;
  const notes = shapeNotes(call.program, routeLine.filter);
  if (ALLOW_COMMANDS.includes(command)) {
    const rules = allowRulesFor(command).map((rule) => `\`${rule}\``).join(', ');
    return `\`${KIT_NAME} ${command}\` reads or writes only the team's own files. It runs with no prompt once the person runs \`${KIT_NAME} automode install --yes\`, which adds the host rule ${rules}; until then, as one plain line of its own${notes}.`;
  }
  const form = ROUTE_FORMS.get(command);
  if (form === undefined) {
    return undefined;
  }
  const landing = LANDING_COMMANDS.includes(command) ? LANDING_NOTE : '';
  return `\`${KIT_NAME} ${command}\` runs with no prompt only as one plain line of its own written \`${form}\`${notes}${landing}, through this install's own ${KIT_NAME}.`;
}
