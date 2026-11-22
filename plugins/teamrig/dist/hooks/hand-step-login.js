import { runsOf } from "../package-guard/programs.js";
import { subcommandOf } from "../package-guard/runners.js";
import { GIT_VALUED_OPTIONS } from "../push-guard/invocations.js";
import { mayBeGhCall } from "./gh-writes.js";
/** The git commands that always reach a remote. */
const NETWORK_GIT = new Set(['push', 'fetch', 'pull', 'clone', 'ls-remote']);
/** The git commands that reach a remote only through one of their subcommands: `git remote update`, `git submodule update`. */
const NETWORK_GIT_SUBCOMMANDS = new Map([
    ['remote', new Set(['update', 'prune', 'show'])],
    ['submodule', new Set(['update'])],
]);
/** The fence info words of each shell; any other fence, or none, is read as both bash and PowerShell. */
const FENCE_DIALECTS = new Map([
    ...['bash', 'sh', 'shell', 'zsh', 'console'].map((word) => [word, 'bash']),
    ...['powershell', 'pwsh', 'ps1', 'ps'].map((word) => [word, 'powershell']),
    ...['cmd', 'bat', 'batch'].map((word) => [word, 'cmd']),
]);
/** A fenced block of a Markdown file: its fence, its info string and its body, up to a closing fence of the same kind. */
const FENCE = /^ {0,3}(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^ {0,3}\1/gmu;
/** An inline code span of a Markdown line: `gh pr view 7`. */
const CODE_SPAN = /`([^`\n]+)`/gu;
/** A prompt a console block writes before a command: `$ `, `> `, `PS C:\x> `. */
const PROMPT = /^[ \t]*(?:\$|>|PS[^>\n]*>)[ \t]+/gmu;
/** The text of each word, joined by spaces. */
function wordsText(words) {
    return words.map((word) => word.text).join(' ');
}
/** True when a git run's words reach a remote: a network command, or one reaching it through its subcommand. */
function reachesRemote(args) {
    const { name, rest } = subcommandOf(args, GIT_VALUED_OPTIONS);
    if (name === undefined) {
        return false;
    }
    if (NETWORK_GIT.has(name)) {
        return true;
    }
    const [sub] = rest;
    return sub !== undefined && !sub.dynamic && (NETWORK_GIT_SUBCOMMANDS.get(name)?.has(sub.text) ?? false);
}
/** The login calls one script makes, read in one dialect, in the order it makes them. */
function scriptCalls(script, dialect, home) {
    const runs = runsOf(script, { cwd: undefined, home, dialect });
    const calls = [];
    for (const run of runs.programs) {
        if (run.name === 'gh') {
            calls.push({ program: 'gh', words: wordsText([run.program, ...run.args]) });
        }
        else if (run.name === 'git' && reachesRemote(run.args)) {
            calls.push({ program: 'git', words: wordsText([run.program, ...run.args]) });
        }
    }
    // A program only known when it runs (`$GH pr merge 7`) whose words read as gh's.
    for (const run of runs.opaque) {
        if (mayBeGhCall(run.args)) {
            calls.push({ program: 'gh', words: wordsText([run.program, ...run.args]) });
        }
    }
    return calls;
}
/** The scripts a Markdown file holds, each with the dialects it is read in: its fenced blocks, then its inline code spans. */
function markdownScripts(text) {
    const scripts = [];
    const BOTH = ['bash', 'powershell'];
    for (const [, , info, body] of text.matchAll(FENCE)) {
        const word = (info ?? '').trim().split(/\s+/u)[0]?.toLowerCase() ?? '';
        const dialect = FENCE_DIALECTS.get(word);
        scripts.push({ script: (body ?? '').replace(PROMPT, ''), dialects: dialect === undefined ? BOTH : [dialect] });
    }
    const prose = text.replace(FENCE, '');
    for (const [, span] of prose.matchAll(CODE_SPAN)) {
        scripts.push({ script: span ?? '', dialects: BOTH });
    }
    return scripts;
}
/**
 * Each call the hand step file of `kind` with `text` makes on the human's login, once each, in file order: a `.ps1`
 * read as PowerShell, a `.sh` as bash, a `.md`'s fenced blocks by their info string and its inline code spans.
 */
export function loginCallsOf(text, kind, home) {
    const scripts = kind === '.md' ? markdownScripts(text) : [{ script: text, dialects: [kind === '.ps1' ? 'powershell' : 'bash'] }];
    const seen = new Set();
    const calls = [];
    for (const { script, dialects } of scripts) {
        for (const dialect of dialects) {
            for (const call of scriptCalls(script, dialect, home)) {
                if (!seen.has(call.words)) {
                    seen.add(call.words);
                    calls.push(call);
                }
            }
        }
    }
    return calls;
}
/**
 * Why `audit --file` refuses the hand step file at `path`, naming each login call it makes and the route instead;
 * undefined when it makes none.
 */
export function loginCallProblem(path, calls) {
    if (calls.length === 0) {
        return undefined;
    }
    const named = calls.map((call) => call.words).join('; ');
    return (`${path} runs on the human's own login: ${named}. A hand step never calls the code host's CLI or a git command that ` +
        "reaches a remote, which take whatever key the human's keyring holds (core rule 11): hand a repository setting as " +
        'a click path in a .md file, and run a host call or a push yourself after, through teamrig, which uses the key the team saved');
}
