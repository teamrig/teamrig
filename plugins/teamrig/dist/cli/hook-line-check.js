import { teamPlace } from "../delivery/places.js";
import { hookScriptsDir, missingHookLines } from "../git-hooks/hook-lines.js";
function warning(check, name, text) {
    return { key: `${check.flag.toLowerCase()} ${name}`, source: check.source, text: `${check.flag} ${name} ${text}` };
}
/** The repository's warning: the hook lines its scripts lack and where to add each; none when they hold them all. */
async function repoWarning(files, git, check, name, main) {
    const hooksDir = git.hooksDir(main);
    if (hooksDir === undefined) {
        return check.unreadable === undefined ? undefined : warning(check, name, check.unreadable(main));
    }
    const scripts = hookScriptsDir(hooksDir);
    const missing = await missingHookLines(files, scripts, check.lines);
    if (missing.length === 0) {
        return undefined;
    }
    const adds = missing.map((hook) => `\`${hook.line}\` to ${hook.hook}`).join(', ');
    return warning(check, name, check.missing(scripts, missing, adds));
}
/** The check's warning for each repository in `delivery.repos`, in their order: one git call, then a read of its scripts. */
export async function hookLineWarnings(files, git, paths, repos, check) {
    const warnings = [];
    for (const [name, repo] of Object.entries(repos)) {
        const found = await repoWarning(files, git, check, name, teamPlace(paths, repo.mainCheckout));
        if (found !== undefined) {
            warnings.push(found);
        }
    }
    return warnings;
}
