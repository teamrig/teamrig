import { compareVersions, parseVersion } from "../core/release-version.js";
/** The long-lived commands an older version leaves running after an update: a task pane's watcher and the UI. */
export const OLD_KIT_WORDS = ['events', 'ui'];
/** A release version folder's name, as `teamrig kit install` names it: MAJOR.MINOR.PATCH, no pre-release part. */
const VERSION = String.raw `\d+\.\d+\.\d+`;
/**
 * A version's CLI entry: its `dist/cli/main.js`, reached directly or through `bin/..` as the sh launcher does, or the
 * sh launcher `bin/teamrig` itself.
 */
const ENTRY = new RegExp(String.raw `^(.*)/(${VERSION})/(?:bin/\.\./)?(?:dist/cli/main\.js|bin/teamrig)$`);
/** A command line's words: a "quoted" word whole, without its quotes, else each run of non-blanks. */
function wordsOf(commandLine) {
    return [...commandLine.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2] ?? '');
}
/**
 * A path in one form for comparing: forward slashes, no trailing slash, and on Windows lower case with a Git Bash
 * drive (`/c/Users`) as a drive letter (`c:/users`), since the sh launcher's line names it so.
 */
function comparable(path, platform) {
    const slashed = path.replaceAll('\\', '/').replace(/\/+$/, '');
    if (platform !== 'win32') {
        return slashed;
    }
    return slashed.replace(/^\/([a-zA-Z])\//, '$1:/').toLowerCase();
}
function isOldKitWord(word) {
    return OLD_KIT_WORDS.some((each) => each === word);
}
/** Whether `version` is a release older than `current`; false when either is no release version. */
function isOlder(version, current) {
    const left = parseVersion(version);
    const right = parseVersion(current);
    return left !== undefined && right !== undefined && compareVersions(left, right) < 0;
}
/**
 * The processes that run `events` or `ui` from a teamrig version older than `current`: a word of the command line is
 * that version's CLI entry in one of `roots`, and the next word is the command. A process is never matched by its
 * program's name, by a word naming a path elsewhere, or for a version not older than `current`.
 */
export function oldKitProcesses(processes, match) {
    const roots = new Set(match.roots.map((root) => comparable(root, match.platform)));
    return processes.flatMap((process) => {
        const words = wordsOf(process.commandLine);
        for (let index = 0; index < words.length; index += 1) {
            const entry = ENTRY.exec(comparable(words[index] ?? '', match.platform));
            const word = words[index + 1];
            if (entry !== null && roots.has(entry[1] ?? '') && isOldKitWord(word)) {
                const version = entry[2] ?? '';
                return isOlder(version, match.current) ? [{ pid: process.pid, version, word }] : [];
            }
        }
        return [];
    });
}
