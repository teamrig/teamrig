import { KIT_NAME } from "../core/home.js";
import { hookLineWarnings } from "./hook-line-check.js";
/** The hooks every repository the team merges into runs the secret scan in, in the order git runs them. */
export const SECRET_HOOKS = [
    { hook: 'pre-commit', command: 'secrets', sub: 'staged', line: `${KIT_NAME} secrets staged || exit 1` },
    { hook: 'commit-msg', command: 'secrets', sub: 'message', line: `${KIT_NAME} secrets message "$1" || exit 1` },
    { hook: 'pre-push', command: 'secrets', sub: 'pushed', line: `${KIT_NAME} secrets pushed "$1" || exit 1` },
];
const SECRET_HOOK_CHECK = {
    flag: 'SECRET-HOOK',
    source: 'the secret hook check [delivery.repos]',
    lines: SECRET_HOOKS,
    unreadable: (main) => `(${main}): git reads no repository there, so its hooks could not be checked for the secret scan`,
    missing: (scripts, missing, adds) => `(${scripts}) runs no secret scan in ${missing.map((hook) => hook.hook).join(', ')}, so a secret there can be committed or pushed: add ${adds}`,
};
/**
 * SECRET-HOOK (T1480), for `check`: each repository the team merges into (`delivery.repos`) whose pre-commit,
 * commit-msg or pre-push script does not call `teamrig secrets`, or which git cannot read.
 */
export async function secretHookWarnings(files, git, paths, repos) {
    return hookLineWarnings(files, git, paths, repos, SECRET_HOOK_CHECK);
}
