import type { CredentialRead } from '../../core/credentials.ts';
import type { ShellEnd } from '../../core/shell-end.ts';
import { githubReposOf, type GithubRepos } from '../../hooks/gh-write-refusals.ts';
import { checkGithubKey, keyCheckText } from '../../issues/github-key-check.ts';
import { keyScopeOf, repoTokenName, tokenName, type KeyScope } from '../../issues/token-names.ts';
import { onePositional, UsageError, type ParsedArgs } from '../args.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';
import { guardLoadOf } from './hook-guard-load.ts';

/** Where a person revokes a GitHub key, which removing it from the store does not do. */
const GITHUB_TOKENS_PAGE = 'https://github.com/settings/personal-access-tokens';

type KeyRuntime = Pick<CliRuntime, 'credentials' | 'keys' | 'out' | 'http' | 'clock'>;

/**
 * `teamrig key list`: each key the team's `github.repos` may use, its owner's and each repository's own, by scope and
 * credential name, and whether the store holds it. A secret is read only to know it is there, never printed.
 */
export async function keyList(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  if (args.positionals.length > 0) {
    throw new UsageError(`teamrig key list takes no scope, it lists the team's: unexpected "${args.positionals.join(' ')}"`);
  }
  const scopes = await teamScopes(runtime, 'list');
  if (scopes.length === 0) {
    runtime.out.stdout(`no repository in github.repos; a key is saved as ${tokenName('<owner>')} for an owner, ${tokenName('<owner>')}.<name> for one repository: teamrig key add <owner|owner/name>`);
    return EXIT.ok;
  }
  for (const scope of scopes) {
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
      return reportCheck(runtime, scope, after.secret);
    case 'missing':
      runtime.out.stderr(`teamrig key add: the store's save command ended, but ${scope.credential} is not there`);
      return EXIT.failed;
    case 'failed':
      runtime.out.stderr(`teamrig key add: ${scope.credential} was saved but does not read back: ${after.reason}`);
      return EXIT.failed;
  }
}

/**
 * `teamrig key check [<owner|owner/name>]`: asks GitHub whose each saved key is, its kind, rights and expiry, sending
 * the key only to GitHub's API host over https (C7); with no scope, every saved key the team's `github.repos` may use.
 * Warns on a classic or never-expiring key and one near its expiry (N1). Fails when a key is refused or unreachable.
 */
export async function keyCheck(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  const scopes = args.positionals.length === 0 ? await teamScopes(runtime, 'check') : [scopeArg(args)];
  if (scopes.length === 0) {
    runtime.out.stdout('no repository in github.repos to check a key for: teamrig key check <owner|owner/name>');
    return EXIT.ok;
  }
  let code: ExitCode = EXIT.ok;
  for (const scope of scopes) {
    const read = await runtime.credentials.read(scope.credential);
    if (read.kind === 'missing') {
      if (args.positionals.length > 0) {
        runtime.out.stderr(`teamrig key check: no key is saved for ${scope.scope} as ${scope.credential}`);
        code = EXIT.failed;
      }
      continue;
    }
    if (read.kind === 'failed') {
      runtime.out.stderr(`teamrig key check: ${scope.credential} is unreadable: ${read.reason}`);
      code = EXIT.failed;
      continue;
    }
    if ((await reportCheck(runtime, scope, read.secret)) !== EXIT.ok) {
      code = EXIT.failed;
    }
  }
  return code;
}

/** Prints what GitHub says of the key saved for `scope`: owner, kind, rights, expiry and warnings, never the key. */
async function reportCheck(runtime: KeyRuntime, scope: KeyScope, secret: string): Promise<ExitCode> {
  const check = await checkGithubKey(runtime.http, secret);
  switch (check.kind) {
    case 'valid': {
      const text = keyCheckText(check, runtime.clock.now());
      runtime.out.stdout(`${scope.scope}  ${scope.credential}  ${text.summary}`);
      for (const warning of text.warnings) {
        runtime.out.stdout(`  warning: ${warning}`);
      }
      return EXIT.ok;
    }
    case 'rejected':
      runtime.out.stderr(`teamrig key check: GitHub refuses the key for ${scope.scope} (${check.status}): it is revoked, expired or mistyped; save a new one with teamrig key add ${scope.scope}`);
      return EXIT.failed;
    case 'failed':
      runtime.out.stderr(`teamrig key check: could not check the key for ${scope.scope}: ${check.reason}`);
      return EXIT.failed;
  }
}

/** The team's scopes from its `github.repos`, refused when that list cannot be read. */
async function teamScopes(runtime: CliRuntime, verb: 'list' | 'check'): Promise<readonly KeyScope[]> {
  const guard = await guardLoadOf(runtime.cwd, runtime);
  const github: GithubRepos = guard === undefined ? { kind: 'none' } : githubReposOf(guard.load);
  if (github.kind === 'unknown') {
    throw new RefusedError(`teamrig key ${verb}: ${github.why}`);
  }
  return github.kind === 'none' ? [] : scopesOf([...github.repos]);
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
