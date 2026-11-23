import { isAbsolute } from 'node:path';
import { isAtOrBelow } from "../core/paths.js";
import { foreignNodeOptions } from "../exec/node-launch.js";
import { posixQuote } from "../open/quote.js";
/** The `credential.helper` value git runs through its shell, with the operation added: `!'<node>' ... '<script>' git-credential`. */
export function helperLine(request) {
    return `!${[request.node, ...request.execArgv, request.script].map(posixQuote).join(' ')} git-credential`;
}
/** Wires the helper in `request.mainDir`'s repository, when its origin is one the scope serves. */
export async function wireCredentialHelper(request, ports) {
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
    const steps = [
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
function optionsProblem(execArgv) {
    const foreign = foreignNodeOptions(execArgv, undefined);
    if (foreign.length === 0) {
        return undefined;
    }
    return `node runs with ${foreign.map(({ option }) => option).join(', ')}, which the helper line would run at every git fetch and push: run teamrig without them`;
}
/** Why the helper may not run the program or script it would name, or undefined when both are absolute and outside every worktree. */
function programPlaceProblem(request, worktrees) {
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
