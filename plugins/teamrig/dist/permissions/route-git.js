import { branchTaskOf } from "../worktree/owner.js";
/** `git [-C <folder>]... <subcommand> <args>`, with no other global option; undefined for anything else. */
function gitLineOf(words, subcommand) {
    const [program, ...rest] = words;
    if (program !== 'git') {
        return undefined;
    }
    const folders = [];
    let at = 0;
    while (rest[at] === '-C') {
        const folder = rest[at + 1];
        if (folder === undefined || folder.startsWith('-')) {
            return undefined;
        }
        folders.push(folder);
        at += 2;
    }
    return rest[at] === subcommand ? { folders, args: rest.slice(at + 1) } : undefined;
}
/** `git commit`'s short options that take no value. */
const COMMIT_FLAGS = new Set(['a', 's', 'q']);
/** `git commit`'s short options that take the next word: the message, or the file it is read from. */
const COMMIT_VALUES = new Set(['m', 'F']);
/** `git commit`'s long options that take no value. */
const COMMIT_LONG_FLAGS = new Set(['--all', '--signoff', '--quiet']);
/** `git commit`'s long options that take a value, as `--name value` or `--name=value`. */
const COMMIT_LONG_VALUES = new Set(['--message', '--file']);
/**
 * C4: `git commit` with only `-a -s -q -m -F` (in clusters, a value letter last), `--all --signoff --quiet --message
 * --file`, and pathspecs. Git permutes options and pathspecs, and `--` ends the options.
 */
export function matchesGitCommit(words) {
    const line = gitLineOf(words, 'commit');
    if (line === undefined) {
        return false;
    }
    const { args } = line;
    for (let at = 0; at < args.length; at += 1) {
        const word = args[at] ?? '';
        if (word === '--') {
            return true;
        }
        if (!word.startsWith('-')) {
            continue;
        }
        const taken = commitOptionTakes(word);
        if (taken === undefined || (taken && !isValue(args[at + 1]))) {
            return false;
        }
        at += taken ? 1 : 0;
    }
    return true;
}
/** Whether a commit option takes the next word; undefined for one off the allowlist. */
function commitOptionTakes(word) {
    if (word.startsWith('--')) {
        const [name = '', value] = splitLong(word);
        if (COMMIT_LONG_FLAGS.has(name) && value === undefined) {
            return false;
        }
        if (COMMIT_LONG_VALUES.has(name)) {
            return value === undefined;
        }
        return undefined;
    }
    const letters = [...word.slice(1)];
    const last = letters.at(-1);
    if (last === undefined || !letters.slice(0, -1).every((letter) => COMMIT_FLAGS.has(letter))) {
        return undefined;
    }
    return COMMIT_VALUES.has(last) ? true : COMMIT_FLAGS.has(last) ? false : undefined;
}
/** `--name=value` as its name and value; a long option written alone has no value. */
function splitLong(word) {
    const equals = word.indexOf('=');
    return equals === -1 ? [word, undefined] : [word.slice(0, equals), word.slice(equals + 1)];
}
/** A value word an option takes: present, and not one git could read as an option of its own. */
function isValue(word) {
    return word !== undefined && !word.startsWith('-');
}
/** `git push`'s short options; a cluster of them is one word. */
const PUSH_FLAGS = new Set(['u', 'q']);
/**
 * `git push`'s long options. The two lease options are the owner's rule of 11-21 (T4908): a rebased branch goes back
 * to the same branch and pull request, so git forces it only while the remote branch is where the session last saw
 * it; `--force`, `-f` and a `+` refspec, which overwrite whatever is there, stay out.
 */
const PUSH_LONG_FLAGS = new Set(['--set-upstream', '--quiet', '--force-with-lease', '--force-if-includes']);
/** The lease option that names its ref: `--force-with-lease=<ref>[:<expect>]`. */
const LEASE_OPTION = '--force-with-lease';
/** A lease's expected commit: an object name, never a revision expression git would resolve at push time. */
const OBJECT_NAME = /^[0-9a-f]{4,64}$/i;
/** A remote name: no URL, path or transport such as `ext::`. */
const REMOTE_NAME = /^[\w.-]+$/;
/** A branch name: no refspec (`:`, `+`), no `refs/` path, no range; checked further in {@link isOwnBranch}. */
const BRANCH_NAME = /^[\w./-]+$/;
/**
 * C5: `git push [-u|--set-upstream] [-q|--quiet] [--force-with-lease[=<branch>[:<sha>]]] [--force-if-includes]
 * <remote> <branch>`, the remote one the repository names, the branch one of a task the caller owns (`t<id>-...`, or
 * `feat/t<id>-...` with the id starting a part: owner.ts `branchTaskOf`) and no protected branch, a lease naming only
 * that same branch, and git's config pushing it to the remote branch of its own name (else a protected branch could
 * be where it lands).
 */
export async function matchesGitPush(words, context) {
    const line = gitLineOf(words, 'push');
    if (line === undefined) {
        return false;
    }
    const [remote, branch, ...more] = line.args.filter((word) => !word.startsWith('-'));
    const task = branch === undefined ? undefined : taskBranchOf(branch, context.protectedBranches);
    if (remote === undefined || branch === undefined || task === undefined || more.length > 0 || !REMOTE_NAME.test(remote)) {
        return false;
    }
    if (!line.args.filter((word) => word.startsWith('-')).every((word) => isPushOption(word, branch))) {
        return false;
    }
    return (await context.ownsTask(task)) && (await context.isRemote(line.folders, remote)) && context.pushesToSameName(line.folders, remote);
}
function isPushOption(word, branch) {
    if (word.startsWith(`${LEASE_OPTION}=`)) {
        return leasesOnly(word.slice(LEASE_OPTION.length + 1), branch);
    }
    if (word.startsWith('--')) {
        return PUSH_LONG_FLAGS.has(word);
    }
    const letters = [...word.slice(1)];
    return letters.length > 0 && letters.every((letter) => PUSH_FLAGS.has(letter));
}
/**
 * True when a lease's `<ref>[:<expect>]` names the pushed branch itself (or its `refs/heads/` path) and expects an
 * object name, or nothing (the branch must not exist yet): a lease on another ref would leave the pushed one unleased.
 */
function leasesOnly(lease, branch) {
    const colon = lease.indexOf(':');
    const ref = colon === -1 ? lease : lease.slice(0, colon);
    const expect = colon === -1 ? '' : lease.slice(colon + 1);
    return (ref === branch || ref === `refs/heads/${branch}`) && (expect === '' || OBJECT_NAME.test(expect));
}
/** The task of a plain task branch (`t<id>-...`, `feat/t<id>-...`) that is no protected branch, whatever its case; else undefined. */
export function taskBranchOf(branch, protectedBranches) {
    const plain = BRANCH_NAME.test(branch) && !branch.includes('..') && !branch.toLowerCase().startsWith('refs/') && branch.toLowerCase() !== 'head';
    const unprotected = !protectedBranches.some((name) => name.toLowerCase() === branch.toLowerCase());
    return plain && unprotected ? branchTaskOf(branch) : undefined;
}
