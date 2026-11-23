import type { CredentialRead } from '../../core/credentials.ts';
import type { ShellEnd } from '../../core/shell-end.ts';
import { githubReposOf, type GithubRepos } from '../../hooks/gh-write-refusals.ts';
import { keyScopeOf, repoTokenName, tokenName, type KeyScope } from '../../issues/token-names.ts';
import { onePositional, UsageError, type ParsedArgs } from '../args.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';
import { guardLoadOf } from './hook-guard-load.ts';

/** Where a person revokes a GitHub key, which removing it from the store does not do. */
const GITHUB_TOKENS_PAGE = 'https://github.com/settings/personal-access-tokens';

type KeyRuntime = Pick<CliRuntime, 'credentials' | 'keys' | 'out'>;

/**
 * `teamrig key list`: each key the team's `github.repos` may use, its owner's and each repository's own, by scope and
 * credential name, and whether the store holds it. A secret is read only to know it is there, never printed.
 */
export async function keyList(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  if (args.positionals.length > 0) {
    throw new UsageError(`teamrig key list takes no scope, it lists the team's: unexpected "${args.positionals.join(' ')}"`);
  }
  const guard = await guardLoadOf(runtime.cwd, runtime);
  const github: GithubRepos = guard === undefined ? { kind: 'none' } : githubReposOf(guard.load);
  if (github.kind === 'unknown') {
    throw new RefusedError(`teamrig key list: ${github.why}`);
  }
  if (github.kind === 'none') {
    runtime.out.stdout(`no repository in github.repos; a key is saved as ${tokenName('<owner>')} for an owner, ${tokenName('<owner>')}.<name> for one repository: teamrig key add <owner|owner/name>`);
    return EXIT.ok;
  }
  for (const scope of scopesOf([...github.repos])) {
    runtime.out.stdout(`${scope.scope}  ${scope.credential}  ${stateText(await runtime.credentials.read(scope.credential), scope)}`);
  }
  return EXIT.ok;
}

/** Each owner of `repos`, then each repository under it, sorted; a repository whose name gives no credential name has no key of its own. */
export function scopesOf(repos: readonly string[]): readonly KeyScope[] {
  const owners = [...new Set(repos.map((repo) => repo.slice(0, repo.indexOf('/')).toLowerCase()))].sort();
  return owners.flatMap((owner) => [
    { scope: owner, credential: tokenName(owner) },
    ...repos
      .filter((repo) => repo.toLowerCase().startsWith(`${owner}/`))
      .map((repo) => repo.toLowerCase())
      .sort()
      .flatMap((repo): KeyScope[] => {
        const credential = repoTokenName(repo);
        return credential === undefined ? [] : [{ scope: repo, credential }];
      }),
  ]);
}

function stateText(read: CredentialRead, scope: KeyScope): string {
  switch (read.kind) {
    case 'found':
      return 'saved';
    case 'failed':
      return `unreadable: ${read.reason}`;
    case 'missing':
      return scope.scope.includes('/') ? "missing: its owner's key reaches it" : 'missing';
  }
}

/**
 * `teamrig key add <owner|owner/name>`: saves the key for an owner or one repository, from a person at a terminal only.
 * The store's own save command runs in that terminal and asks for the key with nothing shown, so the key never passes
 * teamrig, an argument, the environment or a file. A key saved under the name before is replaced, and it says so.
 */
export async function keyAdd(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  const scope = scopeArg(args);
  requirePerson(runtime, 'add');
  const before = await runtime.credentials.read(scope.credential);
  const { keeper, terminal } = runtime.keys;
  runtime.out.stdout(
    `${before.kind === 'found' ? 'replacing the key' : 'saving a key'} for ${scope.scope} as ${scope.credential} in ${keeper.label}; paste it at the prompt, nothing typed shows`,
  );
  const end = await terminal.run(keeper.saveRequest(scope.credential));
  if (!succeeded(end)) {
    runtime.out.stderr(`teamrig key add: the store's save command ${endText(end)}; nothing new is saved for ${scope.scope}`);
    return EXIT.failed;
  }
  return confirmSaved(runtime, scope);
}

async function confirmSaved(runtime: KeyRuntime, scope: KeyScope): Promise<ExitCode> {
  const after = await runtime.credentials.read(scope.credential);
  switch (after.kind) {
    case 'found':
      runtime.out.stdout(`saved: ${scope.scope} now uses ${scope.credential}`);
      return EXIT.ok;
    case 'missing':
      runtime.out.stderr(`teamrig key add: the store's save command ended, but ${scope.credential} is not there`);
      return EXIT.failed;
    case 'failed':
      runtime.out.stderr(`teamrig key add: ${scope.credential} was saved but does not read back: ${after.reason}`);
      return EXIT.failed;
  }
}

/**
 * `teamrig key remove <owner|owner/name>`: removes the saved key, from a person at a terminal only; the key still works
 * until it is revoked at GitHub, which it says. Nothing saved is no failure.
 */
export async function keyRemove(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  const scope = scopeArg(args);
  requirePerson(runtime, 'remove');
  return removeSaved(runtime, scope);
}

async function removeSaved(runtime: KeyRuntime, scope: KeyScope): Promise<ExitCode> {
  const before = await runtime.credentials.read(scope.credential);
  if (before.kind === 'missing') {
    runtime.out.stdout(`no key is saved for ${scope.scope} as ${scope.credential}; nothing to remove`);
    return EXIT.ok;
  }
  const removed = await runtime.keys.keeper.remove(scope.credential);
  if (removed.kind === 'failed') {
    runtime.out.stderr(`teamrig key remove: could not remove ${scope.credential} from ${runtime.keys.keeper.label}: ${removed.reason}`);
    return EXIT.failed;
  }
  runtime.out.stdout(`removed ${scope.credential} from ${runtime.keys.keeper.label}; the key works until you revoke it at ${GITHUB_TOKENS_PAGE}`);
  return EXIT.ok;
}

function scopeArg(args: ParsedArgs): KeyScope {
  const text = onePositional(args, 'owner|owner/name');
  const scope = keyScopeOf(text);
  if (scope === undefined) {
    throw new RefusedError(`${JSON.stringify(text)} is no GitHub owner or owner/name`);
  }
  return scope;
}

/** Saving or removing a key is a person's own act: a session, a pipe or a script gets no terminal and is refused. */
function requirePerson(runtime: Pick<CliRuntime, 'keys'>, verb: 'add' | 'remove'): void {
  if (!runtime.keys.terminal.interactive) {
    throw new RefusedError(`teamrig key ${verb} runs only from a person's own terminal, never a session, a pipe or a script; run it in a terminal yourself`);
  }
}

function succeeded(end: ShellEnd): boolean {
  return end.kind === 'exited' && end.code === 0;
}

function endText(end: ShellEnd): string {
  return end.kind === 'exited' ? `exited ${end.code}` : `was stopped (${end.signal})`;
}
