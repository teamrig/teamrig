import { RepoTokens } from '../../adapters/connectors/github/tokens.ts';
import { resolveKitHome } from '../../core/home.ts';
import { githubReposOf, type GithubRepos } from '../../hooks/gh-write-refusals.ts';
import type { ParsedArgs } from '../args.ts';
import { ghChildEnvOf, ghConfigDirOf, inertCommandOf } from '../gh-child.ts';
import { ghPass } from '../gh-pass.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';
import { guardLoadOf } from './hook-guard-load.ts';

/**
 * `teamrig gh -- <gh args>`: one gh call on the key saved for the owner of the repository it reaches (cli/gh-pass.ts).
 * gh gets an environment built from an allow-list of this process's variables (cli/gh-child.ts), with its browser and
 * editor inert, its config folder teamrig's own `gh-config` in the kit home and `GH_TOKEN` set to that key, so neither
 * the machine's gh login, a token the session holds nor a program it names stands in. The team, and so its
 * `github.repos`, is the folder's; outside a team no repository is the team's.
 */
export async function gh(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  const guard = await guardLoadOf(runtime.cwd, runtime);
  const github: GithubRepos = guard === undefined ? { kind: 'none' } : githubReposOf(guard.load);
  const configDir = ghConfigDirOf(resolveKitHome(runtime.env, runtime.userHome), runtime.platform);
  const childEnv = ghChildEnvOf(runtime.env, { configDir, inert: inertCommandOf(runtime.self.node) });
  const keys = new RepoTokens(runtime.credentials, childEnv);
  const search = { env: runtime.env, platform: runtime.platform, probe: runtime.probe };
  const outcome = await ghPass(args.rest, { run: runtime.run, keys, childEnv, search, configDir, files: runtime.files, env: runtime.env, cwd: runtime.cwd, github, out: runtime.out });
  if (outcome.kind === 'refused') {
    throw new RefusedError(`teamrig gh: ${outcome.why}`);
  }
  return outcome.ok ? EXIT.ok : EXIT.failed;
}
