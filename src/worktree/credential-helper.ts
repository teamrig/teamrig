import { isAbsolute } from 'node:path';
import type { HelperScope, HelperSkip } from '../core/git-credential.ts';
import { isAtOrBelow } from '../core/paths.ts';
import { foreignNodeOptions } from '../exec/node-launch.ts';
import { posixQuote } from '../open/quote.ts';
import type { WorktreeGit } from './git.ts';

/**
 * Makes teamrig git's credential helper for one host in a repository's own config, so git there takes the key teamrig
 * saved for the repository's owner (`teamrig git-credential`) instead of the machine's login. Provider-neutral: which
 * remote URLs get the helper, and under which URL prefix, is the connector's (`HelperScopeOf`).
 *
 * The helper list for the prefix is reset first (an empty value), so a helper set in the user's or the system's
 * config (the OS's manager, another tool's) never answers after teamrig's; teamrig runs by the absolute paths of the
 * Node.js program and the script running now, refused when either is relative or inside one of the repository's
 * worktrees, where a branch could replace it; and git sends the repository's path, which the helper picks the key by.
 * The repository's config is shared by all its worktrees, so wiring one wires them all, and doing it again changes
 * nothing.
 */

/** The scope teamrig's helper serves for a remote URL, or why it serves none there (left as git had it). */
export type HelperScopeOf = (remoteUrl: string) => Promise<HelperScope | HelperSkip>;

/** The git steps the wiring takes. */
export type HelperGit = Pick<WorktreeGit, 'worktrees' | 'originUrl' | 'setLocalConfig'>;

export interface HelperRequest {
  /** The repository's main checkout, where git runs. */
  readonly mainDir: string;
  /** The Node.js program, its options and the teamrig script, the words the helper line runs before its own. */
  readonly node: string;
  readonly execArgv: readonly string[];
  readonly script: string;
  readonly platform: NodeJS.Platform;
}

export type HelperEnd =
  | { readonly kind: 'wired'; readonly line: string }
  | { readonly kind: 'skipped'; readonly why: string }
  | { readonly kind: 'refused'; readonly why: string }
  | { readonly kind: 'failed'; readonly why: string };

/** The `credential.helper` value git runs through its shell, with the operation added: `!'<node>' ... '<script>' git-credential`. */
export function helperLine(request: Pick<HelperRequest, 'node' | 'execArgv' | 'script'>): string {
  return `!${[request.node, ...request.execArgv, request.script].map(posixQuote).join(' ')} git-credential`;
}

/** Wires the helper in `request.mainDir`'s repository, when its origin is one the scope serves. */
export async function wireCredentialHelper(request: HelperRequest, ports: { readonly git: HelperGit; readonly scopeOf: HelperScopeOf }): Promise<HelperEnd> {
  const { mainDir } = request;
  const origin = ports.git.originUrl(mainDir);
  if (origin === undefined) {
    return { kind: 'skipped', why: `${mainDir} has no origin remote git could read` };
  }
  const scope = await ports.scopeOf(origin);
  if ('skip' in scope) {
    return { kind: 'skipped', why: scope.skip };
  }
  const problem = optionsProblem(request.execArgv) ?? programPlaceProblem(request, ports.git.worktrees(mainDir));
  if (problem !== undefined) {
    return { kind: 'refused', why: problem };
  }
  const key = `credential.${scope.urlPrefix}`;
  const steps: readonly (readonly [string, readonly [string, ...string[]]])[] = [
    [`${key}.helper`, ['', helperLine(request)]],
    [`${key}.useHttpPath`, ['true']],
  ];
  for (const [name, values] of steps) {
    const set = ports.git.setLocalConfig(mainDir, name, values);
    if (!set.ok) {
      return { kind: 'failed', why: `git config --local ${name} in ${mainDir}: ${set.reason}; undo it with git config --local --remove-section ${key} there` };
    }
  }
  return { kind: 'wired', line: `git in ${mainDir} now takes the key saved for ${scope.owner} for ${scope.urlPrefix}, through teamrig git-credential` };
}

/**
 * Why the helper may not carry node's launch options, or undefined when each is on `teamrig exec`'s list of options
 * that load no code. The line is saved in the repository's config and runs at every later fetch and push with the key
 * in hand, so an option that loads code (`--import`, `--require`, `--inspect`, a relative path git's folder resolves)
 * would run beside it each time.
 */
function optionsProblem(execArgv: readonly string[]): string | undefined {
  const foreign = foreignNodeOptions(execArgv, undefined);
  if (foreign.length === 0) {
    return undefined;
  }
  return `node runs with ${foreign.map(({ option }) => option).join(', ')}, which the helper line would run at every git fetch and push: run teamrig without them`;
}

/** Why the helper may not run the program or script it would name, or undefined when both are absolute and outside every worktree. */
function programPlaceProblem(request: HelperRequest, worktrees: readonly { readonly path: string }[] | undefined): string | undefined {
  if (worktrees === undefined) {
    return `git could not list the worktrees of ${request.mainDir}, so teamrig cannot tell whether it runs from inside one`;
  }
  for (const program of [request.node, request.script]) {
    if (!isAbsolute(program)) {
      return `${program} is no absolute path, so git would look for it where it runs`;
    }
    const inside = worktrees.find((worktree) => isAtOrBelow(program, worktree.path, request.platform));
    if (inside !== undefined) {
      return `${program} is inside the worktree ${inside.path}, where a branch could change it: run the installed teamrig`;
    }
  }
  return undefined;
}
