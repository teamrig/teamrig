import { outcome, runGit } from "../core/git-run.js";
/** Long enough for git to delete a large worktree. */
const REMOVE_TIMEOUT_MS = 120_000;
/** Long enough to fetch over a slow link, or for git to write out a large worktree. */
const ADD_TIMEOUT_MS = 120_000;
const BRANCH_REF = 'refs/heads/';
/** NUL-separated fields, without the empty one after the last NUL. */
function fields(text) {
    return text.split('\0').filter((field) => field !== '');
}
/** A path git reads as written: no glob, no magic of its own. */
function literal(path) {
    return `:(literal)${path}`;
}
/** The output of `git worktree list --porcelain`: one block per worktree, a blank line between blocks. */
export function parseWorktreeList(text) {
    const entries = [];
    for (const block of text.replaceAll('\r\n', '\n').split('\n\n')) {
        const lines = block.split('\n');
        const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
        if (path === undefined) {
            continue;
        }
        const branchRef = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length);
        const lockLine = lines.find((line) => line === 'locked' || line.startsWith('locked '));
        entries.push({
            path,
            branch: branchRef?.startsWith(BRANCH_REF) === true ? branchRef.slice(BRANCH_REF.length) : undefined,
            locked: lockLine === undefined ? undefined : lockLine.slice('locked'.length).trim(),
        });
    }
    return entries;
}
/**
 * The paths of `git status --porcelain=v1 -z`: each entry is `XY path`, and a rename or copy adds its source as
 * the next field, which names the same change and is skipped.
 */
export function parseStatus(text) {
    const paths = [];
    const parts = fields(text);
    for (let index = 0; index < parts.length; index += 1) {
        const entry = parts[index] ?? '';
        paths.push(entry.slice(3));
        if (/^[RC]|^.[RC]/.test(entry)) {
            index += 1;
        }
    }
    return paths;
}
/**
 * A runner for queries that runs a query git gave no answer of its own to (stopped at its timeout on a loaded host,
 * or it could not start) once more, so the first stall never reads as git's "no" or as "git could not tell" (#847).
 * Only for queries: a step that changes something is never run twice.
 */
export function retryUnanswered(run) {
    return (dir, args, timeout) => {
        const first = run(dir, args, timeout);
        return first.unanswered === undefined ? first : run(dir, args, timeout);
    };
}
/** The worktree port over `run`: its queries through {@link retryUnanswered}, its changing steps run once. */
export function worktreeGit(run) {
    const ask = retryUnanswered(run);
    /** A query's stdout when git exits 0, else undefined. */
    const query = (dir, args) => {
        const result = ask(dir, args);
        return result.status === 0 ? result.stdout : undefined;
    };
    /** A one-line query, trimmed; an empty answer reads as unknown too. */
    const queryLine = (dir, args) => {
        const value = query(dir, args)?.trim();
        return value === '' ? undefined : value;
    };
    /** How many commits of `ref` (a full ref name, or `HEAD`) have no equal change on `base`; undefined when git cannot tell. */
    const refCommitsNotOn = (dir, ref, base) => {
        // Both must name a commit; the caller refuses a base that starts with `-`, which git would read as an option.
        if (queryLine(dir, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]) === undefined || queryLine(dir, ['rev-parse', '--verify', '-q', `${base}^{commit}`]) === undefined) {
            return undefined;
        }
        // Exit 0: base holds the tip; 1: it does not; anything else: git could not tell.
        const ancestor = ask(dir, ['merge-base', '--is-ancestor', ref, base]).status;
        if (ancestor === 0) {
            return 0;
        }
        if (ancestor !== 1) {
            return undefined;
        }
        // `git cherry` marks each commit of the ref `-` when base has an equal change (same patch id), else `+`.
        const cherry = query(dir, ['cherry', base, ref]);
        return cherry === undefined ? undefined : cherry.split('\n').filter((line) => line.startsWith('+')).length;
    };
    /** The subjects `git log` prints for `range`, merges left out, one per commit; undefined when git cannot tell. */
    const subjects = (dir, range) => {
        const text = query(dir, ['log', '--no-merges', '--format=%s', ...range]);
        return text?.replaceAll('\r\n', '\n').split('\n').filter((line) => line !== '');
    };
    return {
        topOf: (dir) => queryLine(dir, ['rev-parse', '--show-toplevel']),
        worktrees(dir) {
            const text = query(dir, ['worktree', 'list', '--porcelain']);
            return text === undefined ? undefined : parseWorktreeList(text);
        },
        changes(top, excluded) {
            const pathspecs = ['.', ...excluded.map((path) => `:(exclude,literal)${path}`)];
            const text = query(top, ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--', ...pathspecs]);
            return text === undefined ? undefined : parseStatus(text);
        },
        tracked(top, paths) {
            if (paths.length === 0) {
                return [];
            }
            const text = query(top, ['ls-files', '-z', '--', ...paths.map(literal)]);
            return text === undefined ? undefined : fields(text);
        },
        defaultBase: (dir) => queryLine(dir, ['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD']),
        commitsNotOn: (dir, branch, base) => refCommitsNotOn(dir, `${BRANCH_REF}${branch}`, base),
        // Run in the worktree's own folder, `HEAD` is that worktree's, not the main checkout's.
        headCommitsNotOn: (top, base) => refCommitsNotOn(top, 'HEAD', base),
        subjectsNotOn(dir, branch, base) {
            const ref = `${BRANCH_REF}${branch}`;
            if (refCommitsNotOn(dir, ref, base) === undefined) {
                return undefined;
            }
            // `--cherry-pick --right-only` keeps the branch's commits with no equal patch on base, as `git cherry` marks `+`;
            // a rebased copy of one sits on base past where the two parted, so only `ref..base` is searched for its subject.
            const own = subjects(dir, ['--cherry-pick', '--right-only', `${base}...${ref}`]);
            const landed = subjects(dir, [`${ref}..${base}`]);
            if (own === undefined || landed === undefined) {
                return undefined;
            }
            const onBase = new Set(landed);
            return own.filter((subject) => !onBase.has(subject)).length;
        },
        tipOf: (dir, branch) => queryLine(dir, ['rev-parse', '--verify', '-q', `${BRANCH_REF}${branch}^{commit}`]),
        // The file is an absolute path and the caller refuses a base that starts with `-`, so neither reads as an option.
        bundle: (mainDir, branch, base, file) => outcome(run(mainDir, ['bundle', 'create', '--quiet', file, `${BRANCH_REF}${branch}`, `^${base}`], ADD_TIMEOUT_MS), 'git bundle create'),
        removeWorktree: (mainDir, top) => outcome(run(mainDir, ['worktree', 'remove', top], REMOVE_TIMEOUT_MS), 'git worktree remove'),
        // A branch name never starts with `-` (git refuses one), so it cannot read as an option.
        deleteBranch: (mainDir, branch) => outcome(run(mainDir, ['branch', '-D', branch]), 'git branch -D'),
        hasBranch(dir, branch) {
            // Exit 0: the ref exists; 1: it does not; anything else: git could not tell.
            const status = ask(dir, ['show-ref', '--verify', '--quiet', `${BRANCH_REF}${branch}`]).status;
            return status === 0 ? true : status === 1 ? false : undefined;
        },
        // The remote and branch come from origin/HEAD, never from the caller's words, so neither starts with `-`.
        fetch: (dir, remote, branch) => outcome(run(dir, ['fetch', '--quiet', remote, branch], ADD_TIMEOUT_MS), 'git fetch'),
        // The caller gives an absolute path and a branch name it checked starts with a letter or digit, so neither reads as an option.
        addWorktree: (mainDir, path, branch, base) => outcome(run(mainDir, ['worktree', 'add', '--quiet', '--no-track', '-b', branch, path, base], ADD_TIMEOUT_MS), 'git worktree add'),
        originUrl: (dir) => queryLine(dir, ['remote', 'get-url', 'origin']),
        setLocalConfig(dir, key, values) {
            // git config takes no `--` (it would store it as the value), so a word starting with `-` is refused, never run.
            const option = [key, ...values].find((word) => word.startsWith('-'));
            if (option !== undefined) {
                return { ok: false, reason: `git config would read ${option} as an option` };
            }
            const [first, ...more] = values;
            let set = outcome(run(dir, ['config', '--local', '--replace-all', key, first]), 'git config');
            for (const value of more) {
                if (!set.ok) {
                    return set;
                }
                set = outcome(run(dir, ['config', '--local', '--add', key, value]), 'git config');
            }
            return set;
        },
    };
}
/** The git CLI. */
export const GIT_WORKTREES = worktreeGit(runGit);
