import { matchesGitCommit, matchesGitPush } from "./route-git.js";
import { KIT_SHAPES, kitCallOf, matchesKit } from "./route-kit.js";
import { matchesLanding } from "./route-pr.js";
import { fitsReadRoute } from "./route-read.js";
import { isRouteFilter } from "./route-filter.js";
import { routeLineOf } from "./route-line.js";
const kit = (shape) => async (words, context) => matchesKit(shape, words, context);
/** The table, in the order {@link routeOf} asks; no line matches two entries. */
export const SANCTIONED_ROUTES = [
    {
        id: 'merge',
        purpose: "merge the branch checked out here into origin's default branch",
        canary: 'teamrig merge --session tr-canary',
        preToolUse: true,
        match: kit(KIT_SHAPES.merge),
    },
    {
        id: 'deploy',
        purpose: "bring what was pushed to a repository's default branch to the running system",
        canary: 'teamrig deploy --session tr-canary --repo canary',
        preToolUse: true,
        match: kit(KIT_SHAPES.deploy),
    },
    {
        id: 'exec-request',
        purpose: 'ask the security reviewer to run a privileged command',
        canary: 'teamrig exec request --session tr-canary --file C:/canary/request.json',
        preToolUse: true,
        match: kit(KIT_SHAPES.execRequest),
    },
    {
        id: 'worktree-remove',
        purpose: 'remove a worktree of your own, unlinking its node_modules first',
        canary: 'teamrig worktree remove C:/canary/t1-canary --session tr-canary --dry-run',
        preToolUse: true,
        match: kit(KIT_SHAPES.worktreeRemove),
    },
    {
        id: 'pr-landing',
        purpose: 'approve or merge a pull request at the head your leader approved',
        canary: 'teamrig pr approve acme/web#7 --head 0123456789abcdef0123456789abcdef01234567 --session tr-canary',
        preToolUse: true,
        match: matchesLanding,
    },
    {
        id: 'read',
        purpose: "read the team's register, plans, budget, checks and inbox status",
        canary: 'teamrig list --session tr-canary',
        preToolUse: true,
        match: async (words, context) => {
            const call = kitCallOf(words, context.cli);
            return call !== undefined && fitsReadRoute(call.parsed) && context.ownClient(call.program);
        },
    },
    {
        id: 'register',
        purpose: 'write the task register and the inbox',
        canary: 'teamrig inbox read --session tr-canary',
        preToolUse: false,
        match: kit(KIT_SHAPES.register),
    },
    {
        id: 'git-commit',
        purpose: 'commit with the hooks running',
        canary: 'git -C C:/canary commit -s -m canary',
        preToolUse: true,
        match: async (words) => matchesGitCommit(words),
    },
    {
        id: 'git-push',
        purpose: 'push a task branch you own to a configured remote',
        canary: 'git -C C:/canary push -u origin t1-canary',
        preToolUse: false,
        match: matchesGitPush,
    },
];
/** The route `line` runs, when it is a route line (C1 as amended by F1-F2) whose command an entry matches. */
async function lineRouteOf(line, context) {
    const routeLine = routeLineOf(line);
    if (routeLine === undefined || (routeLine.filter !== undefined && !isRouteFilter(routeLine.filter))) {
        return undefined;
    }
    for (const route of SANCTIONED_ROUTES) {
        if (await route.match(routeLine.words, context)) {
            return { route, filter: routeLine.filter };
        }
    }
    return undefined;
}
/**
 * The route `line` runs, when it is one plain command an entry matches, alone or piped into one read-only filter
 * (T5070 F1); else undefined.
 */
export async function routeOf(line, context) {
    return (await lineRouteOf(line, context))?.route;
}
/**
 * The route a shell call runs: one only when each text its shell may run (the call's `readings`) is that route, piped
 * into the same filter words or none (F3). Where the host rewrites a line on its way to the shell, which can split or
 * join its words, a line that is a route only as written is judged as the shell runs it (T2332).
 */
export async function shellRouteOf(call, context) {
    const [first, ...rest] = await Promise.all(call.readings.map((reading) => lineRouteOf(reading, context)));
    return first !== undefined && rest.every((reading) => reading !== undefined && sameReading(reading, first)) ? first.route : undefined;
}
function sameReading(one, other) {
    if (one.route !== other.route) {
        return false;
    }
    if (one.filter === undefined || other.filter === undefined) {
        return one.filter === other.filter;
    }
    const otherFilter = other.filter;
    return one.filter.length === otherFilter.length && one.filter.every((word, at) => word === otherFilter[at]);
}
