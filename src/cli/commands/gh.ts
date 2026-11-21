import { RepoTokens } from '../../adapters/connectors/github/tokens.ts';
import { withoutCredentials } from '../../core/child-env.ts';
import { githubReposOf, type GithubRepos } from '../../hooks/gh-write-refusals.ts';
import type { ParsedArgs } from '../args.ts';
import { ghPass } from '../gh-pass.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';
import { guardLoadOf } from './hook-guard-load.ts';

/**
 * `teamrig gh -- <gh args>`: one gh call on the key saved for the owner of the repository it reaches (cli/gh-pass.ts).
 * gh gets this process's environment with every credential variable taken out and `GH_TOKEN` set to that key, so
 * neither the machine's gh login nor a token the session holds stands in for it. The team, and so its `github.repos`,
 * is the folder's; outside a team no repository is the team's.
 */
export async function gh(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  const guard = await guardLoadOf(runtime.cwd, runtime);
  const github: GithubRepos = guard === undefined ? { kind: 'none' } : githubReposOf(guard.load);
  const keys = new RepoTokens(runtime.credentials, withoutCredentials(runtime.env, []));
  const outcome = await ghPass(args.rest, { run: runtime.run, keys, env: runtime.env, cwd: runtime.cwd, github, out: runtime.out });
  if (outcome.kind === 'refused') {
    throw new RefusedError(`teamrig gh: ${outcome.why}`);
  }
  return outcome.ok ? EXIT.ok : EXIT.failed;
}
