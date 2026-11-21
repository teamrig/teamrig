import { teamPlace } from "../delivery/places.js";
import { KIT_NAME } from "../core/home.js";
import { hookScriptsDir, missingHookLines } from "../git-hooks/hook-lines.js";
/** The hooks every repository the team merges into runs the secret scan in, in the order git runs them. */
export const SECRET_HOOKS = [
    { hook: 'pre-commit', command: 'secrets', sub: 'staged', line: `${KIT_NAME} secrets staged || exit 1` },
    { hook: 'commit-msg', command: 'secrets', sub: 'message', line: `${KIT_NAME} secrets message "$1" || exit 1` },
    { hook: 'pre-push', command: 'secrets', sub: 'pushed', line: `${KIT_NAME} secrets pushed "$1" || exit 1` },
];
function warning(name, text) {
    return { key: `secret-hook ${name}`, source: 'the secret hook check [delivery.repos]', text: `SECRET-HOOK ${name} ${text}` };
}
/** The repository's warning: the hooks that lack the scan and the line to add to each; none when all three run it. */
async function repoWarning(files, git, name, main) {
    const hooksDir = git.hooksDir(main);
    if (hooksDir === undefined) {
        return warning(name, `(${main}): git reads no repository there, so its hooks could not be checked for the secret scan`);
    }
    const scripts = hookScriptsDir(hooksDir);
    const missing = await missingHookLines(files, scripts, SECRET_HOOKS);
    if (missing.length === 0) {
        return undefined;
    }
    const adds = missing.map((hook) => `\`${hook.line}\` to ${hook.hook}`).join(', ');
    return warning(name, `(${scripts}) runs no secret scan in ${missing.map((hook) => hook.hook).join(', ')}, so a secret there can be committed or pushed: add ${adds}`);
}
/**
 * SECRET-HOOK (T1480), for `check`: each repository the team merges into (`delivery.repos`) whose pre-commit,
 * commit-msg or pre-push script does not call `teamrig secrets`, or which git cannot read. A repository's hooks are
 * its own, not one session's area, so it is a warning no session owns and goes to the lead. One git call per
 * repository, then a read of its three scripts.
 */
export async function secretHookWarnings(files, git, paths, repos) {
    const warnings = [];
    for (const [name, repo] of Object.entries(repos)) {
        const found = await repoWarning(files, git, name, teamPlace(paths, repo.mainCheckout));
        if (found !== undefined) {
            warnings.push(found);
        }
    }
    return warnings;
}
