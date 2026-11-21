import { basename, dirname, join } from 'node:path';
import { KIT_NAME } from "../core/home.js";
/**
 * Whether a line of a hook script, other than a comment line, calls the hook line's subcommand: through the `teamrig`
 * command, or `src/cli/main.ts` in teamrig's own repository, which runs its source.
 */
export function callsHookLine(script, hookLine) {
    const call = new RegExp(`(?:\\b${KIT_NAME}|cli/main\\.ts)\\s+${hookLine.command}\\s+${hookLine.sub}\\b`);
    return script.split('\n').some((line) => !line.trimStart().startsWith('#') && call.test(line));
}
/** The folder holding the hook scripts a person writes: husky points git at `.husky/_`, whose hooks run `.husky/<hook>`. */
export function hookScriptsDir(hooksDir) {
    const parent = dirname(hooksDir);
    return basename(hooksDir) === '_' && basename(parent) === '.husky' ? parent : hooksDir;
}
/** The hook lines whose script in `scriptsDir` does not call them, in the order given; a missing script calls none. */
export async function missingHookLines(files, scriptsDir, hookLines) {
    const missing = [];
    for (const hookLine of hookLines) {
        if (!callsHookLine((await files.read(join(scriptsDir, hookLine.hook))) ?? '', hookLine)) {
            missing.push(hookLine);
        }
    }
    return missing;
}
