/**
 * teamrig's hooks file, rewritten as one Antigravity CLI (`agy`) loads.
 *
 * agy's hooks file has its own shape (`https://antigravity.google/docs/hooks/`, read 2026-11-20 for agy 1.5.12): each
 * top-level key names a hook group, and a group maps agy's six event names to handlers. PreToolUse and PostToolUse
 * take `{ matcher, hooks }` entries, the other events a flat list of handlers. A handler is one `command` string,
 * run by `sh -c`, or by `cmd /c` on Windows, from the folder that holds the hooks file. An event name agy does not
 * know is accepted and never fires, so teamrig's file, with its own event names and `modules` key, would load and do
 * nothing. agy's hook input does not name its event, so each command line carries it as `--host-event <event>`, and
 * names agy's host as `--host antigravity-cli` in place of the host the source's line names.
 *
 * A hooks file that lost a guard on the way would look like a working one, so a source this module does not know in
 * full is refused whole with a reason: a key, an event or a handler field it has no rule for, or a word the shell
 * cannot carry unchanged, or a tool matcher naming a tool `tool-matchers.ts` has no rule for. What is left out on
 * purpose is listed in `skipped`, never dropped silently. A tool matcher is rewritten in agy's tool names, since agy
 * matches its own tools' names and a Claude Code name never fires there.
 */
import { declaration } from "./declaration.js";
import { agyMatcherOf } from "./tool-matchers.js";
/**
 * Where each of teamrig's events runs on agy. agy has no prompt event; PreInvocation runs before every model call
 * and sees the last prompt, so what teamrig hooks to a typed prompt runs there.
 */
const AGY_EVENT_OF = {
    SessionStart: 'SessionStart',
    UserPromptSubmit: 'PreInvocation',
    PreToolUse: 'PreToolUse',
    PostToolUse: 'PostToolUse',
    Stop: 'Stop',
};
/** teamrig's events that agy 1.5.12 does not fire. */
const EVENTS_AGY_LACKS = [
    'PermissionRequest',
    'PostToolUseFailure',
    'Elicitation',
    'ElicitationResult',
    'StopFailure',
    'PreCompact',
    'PostCompact',
    'SessionEnd',
    'SubagentStart',
    'SubagentStop',
];
const PLUGIN_ROOT = '${CLAUDE_PLUGIN_ROOT}';
const DEFAULT_TIMEOUT_SECONDS = 15;
const DEFAULT_GROUP_NAME = 'teamrig';
const EVERY_TOOL = '*';
const EVENT_FLAG = '--host-event';
const HOST_FLAG = '--host';
/** This adapter's id in teamrig's host table, which each hook line names so the run loads agy's ports. */
export const ANTIGRAVITY_CLI_HOST = declaration.id;
const FILE_KEYS = ['description', 'modules', 'hooks'];
const GROUP_KEYS = ['matcher', 'hooks'];
const HANDLER_KEYS = ['type', 'command', 'args', 'timeout', 'asyncRewake'];
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u;
const SH_PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/u;
const CMD_PLAIN_WORD = /^[A-Za-z0-9_+:./\\-]+$/u;
const TRAILING_BACKSLASHES = /\\+$/u;
/**
 * Characters a `cmd` line cannot carry as text: a quote ends the quoting, `%` and `!` start a variable even inside
 * quotes (`!` when delayed expansion is on), and a line break ends the line.
 */
const CMD_UNSAFE = ['"', '%', '!', '\r', '\n', '\0'];
const SH_UNSAFE = ['\r', '\n', '\0'];
class UnknownSource extends Error {
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isStringList(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
function isToolEvent(event) {
    return event === 'PreToolUse' || event === 'PostToolUse';
}
function recordOf(value, what, keys) {
    if (!isRecord(value)) {
        throw new UnknownSource(`${what} is not a JSON object`);
    }
    const unknown = Object.keys(value).find((key) => !keys.includes(key));
    if (unknown !== undefined) {
        throw new UnknownSource(`${what} holds the key ${unknown}, which the Antigravity hooks file has no rule for`);
    }
    return value;
}
function listOf(value, what) {
    if (!Array.isArray(value)) {
        throw new UnknownSource(`${what} is not a list`);
    }
    return value;
}
function timeoutOf(value, what) {
    if (value === undefined) {
        return DEFAULT_TIMEOUT_SECONDS;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new UnknownSource(`${what} holds a timeout that is not a whole number of seconds above 0`);
    }
    return value;
}
function readHandler(value, what) {
    const handler = recordOf(value, what, HANDLER_KEYS);
    if (handler['type'] !== 'command') {
        throw new UnknownSource(`${what} is not of type command`);
    }
    const command = handler['command'];
    if (typeof command !== 'string') {
        throw new UnknownSource(`${what} has no command`);
    }
    const args = handler['args'] ?? [];
    if (!isStringList(args)) {
        throw new UnknownSource(`${what} holds args that are not a list of strings`);
    }
    const rewake = handler['asyncRewake'] ?? false;
    if (typeof rewake !== 'boolean') {
        throw new UnknownSource(`${what} holds an asyncRewake that is not true or false`);
    }
    return { words: [command, ...args], timeout: timeoutOf(handler['timeout'], what), rewake };
}
function readGroup(value, what) {
    const group = recordOf(value, what, GROUP_KEYS);
    const matcher = group['matcher'];
    if (matcher !== undefined && typeof matcher !== 'string') {
        throw new UnknownSource(`${what} holds a matcher that is not a string`);
    }
    const handlers = listOf(group['hooks'], `${what}'s hooks`).map((handler, index) => readHandler(handler, `${what}, handler ${index + 1}`));
    return { matcher, handlers };
}
function readEvent(name, value) {
    if (AGY_EVENT_OF[name] === undefined && !EVENTS_AGY_LACKS.includes(name)) {
        throw new UnknownSource(`the hooks file names the event ${name}, which the Antigravity hooks file has no rule for`);
    }
    const groups = listOf(value, `the ${name} entry`).map((group, index) => readGroup(group, `${name} group ${index + 1}`));
    return { name, groups };
}
function readSource(source) {
    const file = recordOf(source, 'the hooks file', FILE_KEYS);
    const description = file['description'];
    if (description !== undefined && typeof description !== 'string') {
        throw new UnknownSource('the hooks file holds a description that is not a string');
    }
    const modules = file['modules'];
    if (modules !== undefined && !isStringList(modules)) {
        throw new UnknownSource('the hooks file holds modules that are not a list of strings');
    }
    const hooks = file['hooks'];
    if (!isRecord(hooks)) {
        throw new UnknownSource('the hooks file has no hooks object');
    }
    return Object.entries(hooks).map(([name, value]) => readEvent(name, value));
}
function shWord(word) {
    return SH_PLAIN_WORD.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}
/**
 * A word inside `cmd` quotes reaches the program through the C runtime's rule, where a backslash before a quote
 * escapes it: the word's last backslashes are doubled so the closing quote stays a quote.
 */
function cmdWord(word) {
    return CMD_PLAIN_WORD.test(word) ? word : `"${word.replace(TRAILING_BACKSLASHES, (run) => run + run)}"`;
}
function checkWord(word, shell, what) {
    if (word === '') {
        throw new UnknownSource(`${what} holds an empty word`);
    }
    if (word.includes('${')) {
        throw new UnknownSource(`${what} holds a variable other than ${PLUGIN_ROOT}, which agy does not fill`);
    }
    if (SH_UNSAFE.some((character) => word.includes(character))) {
        throw new UnknownSource(`${what} holds a line break, which no command line carries`);
    }
    if (shell === 'cmd' && CMD_UNSAFE.some((character) => word.includes(character))) {
        throw new UnknownSource(`${what} holds a quote, a percent sign or an exclamation mark, which a cmd line cannot carry as text`);
    }
}
/**
 * The source's words without the host it names: teamrig's file is Claude Code's, whose lines say `--host claude-code`,
 * and an agy line must load agy's ports instead.
 */
function withoutHost(words, what) {
    const kept = [];
    for (let index = 0; index < words.length; index += 1) {
        const word = words[index] ?? '';
        if (word !== HOST_FLAG) {
            kept.push(word);
            continue;
        }
        if (words[index + 1] === undefined) {
            throw new UnknownSource(`${what} ends with ${HOST_FLAG} and names no host`);
        }
        index += 1;
    }
    return kept;
}
function commandLine(sourceWords, event, options, what) {
    const words = [
        ...withoutHost(sourceWords, what).map((word) => word.replaceAll(PLUGIN_ROOT, options.pluginRoot)),
        HOST_FLAG,
        ANTIGRAVITY_CLI_HOST,
        EVENT_FLAG,
        event,
    ];
    for (const word of words) {
        checkWord(word, options.shell, what);
    }
    if (options.shell === 'sh') {
        return words.map(shWord).join(' ');
    }
    // `cmd /c "<line>"` keeps a line's quotes only when the line does not start with one.
    if (!CMD_PLAIN_WORD.test(words[0] ?? '')) {
        throw new UnknownSource(`${what} starts with a program name that needs quotes on cmd`);
    }
    return words.map(cmdWord).join(' ');
}
function skippedHandler(event, group, handler, reason) {
    return { event, ...(group.matcher === undefined ? {} : { matcher: group.matcher }), words: handler.words, reason };
}
/** agy's matcher for a group of a tool event: every tool when the source names none, undefined when agy has no such tool. */
function agyMatcher(group, what) {
    if (group.matcher === undefined) {
        return EVERY_TOOL;
    }
    const rewritten = agyMatcherOf(group.matcher);
    if (!rewritten.ok) {
        throw new UnknownSource(`${what}: ${rewritten.reason}`);
    }
    return rewritten.matcher;
}
function rewriteEvent(source, event, options) {
    const groups = [];
    const skipped = [];
    source.groups.forEach((group, groupIndex) => {
        const matcher = isToolEvent(event) ? agyMatcher(group, `${source.name} group ${groupIndex + 1}`) : EVERY_TOOL;
        const hooks = [];
        group.handlers.forEach((handler, handlerIndex) => {
            if (handler.rewake) {
                skipped.push(skippedHandler(source.name, group, handler, 'rewake agy lacks'));
                return;
            }
            // Only the tool events match; a matcher anywhere else narrows a handler agy would run on every firing.
            if (group.matcher !== undefined && !isToolEvent(event)) {
                skipped.push(skippedHandler(source.name, group, handler, 'matcher agy cannot hold'));
                return;
            }
            if (matcher === undefined) {
                skipped.push(skippedHandler(source.name, group, handler, 'tool agy lacks'));
                return;
            }
            const what = `${source.name} group ${groupIndex + 1}, handler ${handlerIndex + 1}`;
            hooks.push({ type: 'command', command: commandLine(handler.words, event, options, what), timeout: handler.timeout });
        });
        if (hooks.length > 0 && matcher !== undefined) {
            groups.push({ matcher, hooks });
        }
    });
    return { groups, skipped };
}
function rewrite(events, options) {
    const matched = {};
    const flat = {};
    const skipped = [];
    for (const source of events) {
        const event = AGY_EVENT_OF[source.name];
        if (event === undefined) {
            for (const group of source.groups) {
                skipped.push(...group.handlers.map((handler) => skippedHandler(source.name, group, handler, 'event agy lacks')));
            }
            continue;
        }
        const rewritten = rewriteEvent(source, event, options);
        skipped.push(...rewritten.skipped);
        if (rewritten.groups.length === 0) {
            continue;
        }
        if (isToolEvent(event)) {
            matched[event] = [...(matched[event] ?? []), ...rewritten.groups];
        }
        else {
            flat[event] = [...(flat[event] ?? []), ...rewritten.groups.flatMap((group) => group.hooks)];
        }
    }
    const group = { ...flat, ...matched };
    return { ok: true, file: { [options.groupName ?? DEFAULT_GROUP_NAME]: group }, skipped };
}
/**
 * Rewrites teamrig's parsed hooks file for agy: its events on agy's six, one command line for the host's shell with
 * the plugin's real path and the agy event in it, and each handler's own timeout.
 */
export function antigravityHooksFile(source, options) {
    // agy runs a hook from the folder of its hooks file, so a relative path would be read from there, not the plugin.
    if (!ABSOLUTE_PATH.test(options.pluginRoot)) {
        return { ok: false, reason: 'the plugin root is not an absolute path' };
    }
    if (options.groupName !== undefined && options.groupName.trim() === '') {
        return { ok: false, reason: 'the hook group name is empty' };
    }
    try {
        return rewrite(readSource(source), options);
    }
    catch (error) {
        if (error instanceof UnknownSource) {
            return { ok: false, reason: error.message };
        }
        throw error;
    }
}
