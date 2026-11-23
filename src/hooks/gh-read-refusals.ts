import type { LineRuns } from '../package-guard/programs.ts';
import type { ShellDialect, ShellWord } from '../push-guard/tokenizer.ts';
import { ghReachOf, ownerOfRepo } from './gh-reach.ts';
import { folderReposOf, placementInDoubt, teamrigIssueCall, type GhWriteEnv } from './gh-write-refusals.ts';
import { ghCallOf, ghCommandSlotOf, mayBeGhCall } from './gh-writes.ts';

/**
 * The exec guard's check on raw `gh` reads (T4896): a read on an owner of the team's repositories
 * (`github.repos`) runs on the key the team saved for that owner, through `teamrig gh -- <args>`, never on this
 * machine's own gh login, which may be another project's key. Keys are saved per owner, so every repository of a team
 * owner counts, not only the ones the config names. A call teamrig gh would refuse itself (gh's own login or
 * settings, an alias, another host) passes, as does every read while the config names no repository or does not
 * load (the write check fails closed there; a read changes nothing). It reads only the line's own words, so it is a
 * check against mistakes.
 */

/** One gh call on the line, where it runs, and whether its program is only known when it runs (`$GH pr view 5`). */
interface GhRead {
  readonly args: readonly ShellWord[];
  readonly dir: string | undefined;
  readonly dialect: ShellDialect;
  readonly opaque: boolean;
}

/** A word gh's line takes as one argument with no quotes in every dialect. */
const PLAIN_WORD = /^[\w@%+=:,./#-]+$/u;

/** A word written back into a `teamrig gh` line for the dialect it was run in; a word only known when it runs stays as written. */
function wordFor(word: ShellWord, dialect: ShellDialect): string {
  if (word.dynamic || PLAIN_WORD.test(word.text)) {
    return word.text;
  }
  if (dialect === 'cmd') {
    return `"${word.text.replace(/"/gu, '\\"')}"`;
  }
  return `'${word.text.replace(/'/gu, dialect === 'powershell' ? "''" : `'\\''`)}'`;
}

/** The call as the refusal names it: `gh api`, else `gh <group> <command>`. */
function whatOf(args: readonly ShellWord[]): string {
  const [group] = args;
  if (group === undefined || group.text === 'api') {
    return 'gh api';
  }
  const slot = ghCommandSlotOf(args.slice(1));
  return slot.kind === 'command' && slot.command !== undefined ? `gh ${group.text} ${slot.command.text}` : `gh ${group.text}`;
}

/** The team owners a read reaches, or undefined when the guard cannot place a read on the folder's repository. */
function teamOwnersOf(read: GhRead, teamOwners: ReadonlySet<string>, folder: () => readonly string[] | undefined): readonly string[] | undefined {
  const reach = ghReachOf(read.args);
  if (reach.kind === 'refused') {
    return [];
  }
  // A team owner's every repository is the team's to read on its saved key, so the guard judges by owner, not repo.
  if (reach.kind === 'targets') {
    return [...new Set(reach.targets.map((target) => target.owner))].filter((owner) => teamOwners.has(owner));
  }
  // A folder-placed read through a program only known when it runs passes: `run`, `status`, `api` and `search` are
  // words of other programs too, and `$NPM run build` must not be refused.
  if (read.opaque) {
    return [];
  }
  const repos = folder();
  return repos === undefined ? undefined : [...new Set(repos.map(ownerOfRepo))].filter((owner) => teamOwners.has(owner));
}

/** Why the guard refuses one raw gh read, or undefined when it reaches no team owner. */
function readRefusalOf(read: GhRead, teamOwners: ReadonlySet<string>, folder: () => readonly string[] | undefined): string | undefined {
  if (ghCallOf(read.args).kind !== 'read') {
    return undefined;
  }
  const hit = teamOwnersOf(read, teamOwners, folder);
  const what = whatOf(read.args);
  const route = `\`teamrig gh -- ${read.args.map((word) => wordFor(word, read.dialect)).join(' ')}\``;
  if (hit === undefined) {
    const owners = [...teamOwners].sort().join(', ');
    return `\`${what}\` reads the repository of the folder it runs in (or \`GH_REPO\`) with this machine's own gh login, and the guard cannot tell which it is: the line may change it, git cannot tell, or a remote reaches GitHub in a form the guard cannot read. On a repository of ${owners}, run it on the key the team saved, naming the repository with \`-R <owner>/<name>\`: ${route}.`;
  }
  if (hit.length === 0) {
    return undefined;
  }
  return `\`${what}\` reads ${hit.join(', ')}'s repositories with this machine's own gh login, which may be another project's key. Run it on the key the team saved for ${hit.join(', ')}: ${route}.`;
}

/**
 * Why the guard refuses each raw `gh` read on the line that reaches an owner of the team's repositories: its `gh`
 * runs, and each program only known when it runs whose words read as a gh call naming its repository
 * (`$GH pr view 5 -R acme/web`).
 */
export function ghReadRefusals(runs: LineRuns, env: GhWriteEnv): string[] {
  const repoConfig = env.github;
  if (repoConfig.kind !== 'repos') {
    return [];
  }
  const reads: readonly GhRead[] = [
    ...runs.programs.filter((run) => run.name === 'gh').map((run) => ({ args: run.args, dir: run.dir, dialect: run.dialect, opaque: false })),
    ...runs.opaque.filter((run) => mayBeGhCall(run.args) && !teamrigIssueCall(run.args)).map((run) => ({ args: run.args, dir: undefined, dialect: run.dialect, opaque: true })),
  ];
  if (reads.length === 0) {
    return [];
  }
  const teamOwners: ReadonlySet<string> = new Set([...repoConfig.repos].map(ownerOfRepo));
  const doubt = placementInDoubt(runs);
  return reads.flatMap((read) => {
    const why = readRefusalOf(read, teamOwners, () => folderReposOf(read.dir, env, doubt));
    return why === undefined ? [] : [why];
  });
}
