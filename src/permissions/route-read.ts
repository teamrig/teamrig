import type { ParsedArgs } from '../cli/args.ts';

/**
 * The read route (T5070, security verdict T5072 C3, C4): the CLI commands whose table effect is `read` that a session
 * may run with no prompt and no classifier. A closed inventory, not every read row: a spec fails while a `read` row of
 * the CLI table is in neither {@link READ_ROUTE_COMMANDS} nor {@link READ_ROUTE_EXCLUDED}, or a listed command is no
 * longer `read`, so a new read command waits for a choice, and a change to either list goes to the security reviewer.
 */

/** How many words that are no flag a read command takes: none, exactly one, at most one, or any number. */
export type ReadPositionals = 'none' | 'one' | 'optional' | 'any';

/** The read commands that are a route, each with the positionals it takes. Each matches only its table flags. */
export const READ_ROUTE_COMMANDS: ReadonlyMap<string, ReadPositionals> = new Map<string, ReadPositionals>([
  ['list', 'none'],
  ['show', 'any'],
  ['check', 'none'],
  ['plan', 'none'],
  ['verify', 'none'],
  ['stats', 'none'],
  ['report done', 'none'],
  ['goal list', 'none'],
  ['goal show', 'one'],
  ['inbox status', 'none'],
  ['exec status', 'optional'],
  ['team tree', 'none'],
  ['rules', 'none'],
  ['rules scan', 'none'],
  ['skills scorecard', 'none'],
  ['meeting list', 'none'],
  ['decisions', 'none'],
  ['restore', 'none'],
  ['who', 'optional'],
  ['read', 'any'],
  ['sessions', 'none'],
  ['roles list', 'none'],
  ['doctor', 'none'],
  ['issue similar', 'one'],
  ['budget', 'optional'],
  ['schedule', 'none'],
  ['burst', 'none'],
  ['setup scan', 'none'],
  ['config get', 'optional'],
  ['config validate', 'none'],
  ['commits check', 'none'],
  ['changes', 'none'],
  ['secrets staged', 'none'],
  ['secrets pushed', 'one'],
  ['pipeline', 'none'],
  ['stable-periods', 'none'],
  ['deploy-status', 'none'],
  ['steps', 'none'],
]);

/** The read commands that are no route, each with why: a person's prompt or the classifier still judges them. */
export const READ_ROUTE_EXCLUDED: ReadonlyMap<string, string> = new Map([
  ['secrets message', 'it reads a file the caller names and prints from it (C4); its git hook runs it with no tool call'],
  ['key list', 'it reads the credential store, which holds the keys; a prompt judges each read of it'],
  ['key check', 'it reads a key from the credential store and sends it over the network to the code host'],
  ['channel', 'an allow rule for its words would also approve `channel stable|preview --yes`, which writes user settings and reinstalls the plugin (T5232 C1)'],
]);

/** Flags that make a listed command no route: each opens a folder the caller names and prints from it (C4). */
const REFUSED_OPTIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ['sessions', ['project']],
  ['setup scan', ['project']],
]);

/**
 * True when the CLI's reading of a line runs a read route: a listed command, none of its refused flags, the positionals
 * it takes, and no flag value or positional that starts with `-`, which a command may pass on to a program as a flag
 * (`commits check --base` reaches `git log <base>..<tip>`).
 */
export function fitsReadRoute(parsed: ParsedArgs): boolean {
  const positionals = READ_ROUTE_COMMANDS.get(parsed.command);
  if (positionals === undefined) {
    return false;
  }
  const refused = REFUSED_OPTIONS.get(parsed.command) ?? [];
  if (refused.some((name) => parsed.flags.has(name) || parsed.switches.has(name))) {
    return false;
  }
  const values = [...parsed.flags.values(), ...parsed.common.values(), ...parsed.positionals];
  return values.every((value) => !value.startsWith('-')) && positionalsFit(positionals, parsed.positionals.length);
}

function positionalsFit(shape: ReadPositionals, count: number): boolean {
  switch (shape) {
    case 'none':
      return count === 0;
    case 'one':
      return count === 1;
    case 'optional':
      return count <= 1;
    case 'any':
      return true;
  }
}
