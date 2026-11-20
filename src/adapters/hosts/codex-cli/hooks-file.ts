/**
 * teamrig's hooks file, rewritten as one Codex CLI 0.170.0 loads.
 *
 * Codex reads a hooks file with every unknown top-level field refused (`HooksFile` in
 * `codex-rs/config/src/hook_config.rs`, tag rust-v0.170.0), so teamrig's own file, with its `modules` key, does not
 * load there at all. A handler is one command line, `command` run by `$SHELL -lc` and `commandWindows` by `cmd /C`
 * (`codex-rs/hooks/src/engine/command_runner.rs`); there is no `args` list and no rewake
 * (`HookHandlerConfig` in `codex-rs/protocol/src/hooks.rs`).
 *
 * A hooks file that lost a guard on the way would look like a working one, so a source this module does not know in
 * full is refused whole with a reason: a key, an event or a handler field it has no rule for, or a word neither shell
 * can carry unchanged. What is left out on purpose is listed in `skipped`, never dropped silently. Matchers are kept
 * as they are: which Codex tool a matcher's name stands for is the host port's rule, not this file's.
 */

import { isSharedHookEvent, type SharedHookEvent } from './events.ts';

/** One command hook as Codex reads it. */
export interface CodexHookHandler {
  readonly type: 'command';
  /** The line `$SHELL -lc` runs. */
  readonly command: string;
  /** The line `cmd /C` runs. */
  readonly commandWindows: string;
  /** Seconds. Always written: Codex's own default is 600. */
  readonly timeout: number;
  /** `0` stops Codex from moving a long context to a file and handing the model only its start. */
  readonly additionalContextLimit?: 0;
}

export interface CodexMatcherGroup {
  readonly matcher?: string;
  readonly hooks: readonly CodexHookHandler[];
}

export interface CodexHooksFile {
  readonly description?: string;
  readonly hooks: Readonly<Partial<Record<SharedHookEvent, readonly CodexMatcherGroup[]>>>;
}

/** Why a handler of teamrig's file is not in the Codex one. */
export type SkipReason = 'event Codex lacks' | 'rewake Codex lacks';

export interface SkippedHandler {
  readonly event: string;
  readonly matcher?: string;
  /** The handler's command and arguments as teamrig's file holds them. */
  readonly words: readonly string[];
  readonly reason: SkipReason;
}

export interface CodexHooksFileOptions {
  /** The absolute path of the installed plugin, written in place of `${CLAUDE_PLUGIN_ROOT}`. */
  readonly pluginRoot: string;
  /** teamrig's own description names Claude Code features, so the Codex file carries one only when given. */
  readonly description?: string;
}

export type CodexHooksFileResult =
  | { readonly ok: true; readonly file: CodexHooksFile; readonly skipped: readonly SkippedHandler[] }
  | { readonly ok: false; readonly reason: string };

/** The events of teamrig's file that Codex 0.170.0 does not fire. */
const EVENTS_CODEX_LACKS: readonly string[] = ['PostToolUseFailure', 'Elicitation', 'ElicitationResult', 'StopFailure'];

/** Codex spills a hook's context past about 2,500 tokens to a file; these events carry the team rules and the inbox. */
const CONTEXT_EVENTS: readonly SharedHookEvent[] = ['SessionStart', 'UserPromptSubmit', 'SubagentStart'];
const NO_CONTEXT_LIMIT = { additionalContextLimit: 0 } as const;

const PLUGIN_ROOT = '${CLAUDE_PLUGIN_ROOT}';
const DEFAULT_TIMEOUT_SECONDS = 15;

const FILE_KEYS: readonly string[] = ['description', 'modules', 'hooks'];
const GROUP_KEYS: readonly string[] = ['matcher', 'hooks'];
const HANDLER_KEYS: readonly string[] = ['type', 'command', 'args', 'timeout', 'asyncRewake'];

const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u;
const POSIX_PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/u;
const CMD_PLAIN_WORD = /^[A-Za-z0-9_+:./\\-]+$/u;
const TRAILING_BACKSLASHES = /\\+$/u;

/**
 * Characters a `cmd` line cannot carry as text: a quote ends the quoting, `%` and `!` start a variable even inside
 * quotes (`!` when delayed expansion is on), and a line break ends the line.
 */
const CMD_UNSAFE = ['"', '%', '!', '\r', '\n', '\0'] as const;
const POSIX_UNSAFE = ['\r', '\n', '\0'] as const;

class UnknownSource extends Error {}

interface SourceHandler {
  readonly words: readonly string[];
  readonly timeout: number;
  readonly rewake: boolean;
}

interface SourceGroup {
  readonly matcher: string | undefined;
  readonly handlers: readonly SourceHandler[];
}

interface SourceEvent {
  readonly name: string;
  readonly groups: readonly SourceGroup[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function recordOf(value: unknown, what: string, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new UnknownSource(`${what} is not a JSON object`);
  }
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown !== undefined) {
    throw new UnknownSource(`${what} holds the key ${unknown}, which the Codex hooks file has no rule for`);
  }
  return value;
}

function listOf(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new UnknownSource(`${what} is not a list`);
  }
  return value;
}

function timeoutOf(value: unknown, what: string): number {
  if (value === undefined) {
    return DEFAULT_TIMEOUT_SECONDS;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new UnknownSource(`${what} holds a timeout that is not a whole number of seconds above 0`);
  }
  return value;
}

function readHandler(value: unknown, what: string): SourceHandler {
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

function readGroup(value: unknown, what: string): SourceGroup {
  const group = recordOf(value, what, GROUP_KEYS);
  const matcher = group['matcher'];
  if (matcher !== undefined && typeof matcher !== 'string') {
    throw new UnknownSource(`${what} holds a matcher that is not a string`);
  }
  const handlers = listOf(group['hooks'], `${what}'s hooks`).map((handler, index) => readHandler(handler, `${what}, handler ${index + 1}`));
  return { matcher, handlers };
}

function readEvent(name: string, value: unknown): SourceEvent {
  if (!isSharedHookEvent(name) && !EVENTS_CODEX_LACKS.includes(name)) {
    throw new UnknownSource(`the hooks file names the event ${name}, which the Codex hooks file has no rule for`);
  }
  const groups = listOf(value, `the ${name} entry`).map((group, index) => readGroup(group, `${name} group ${index + 1}`));
  return { name, groups };
}

function readSource(source: unknown): readonly SourceEvent[] {
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

function posixWord(word: string): string {
  return POSIX_PLAIN_WORD.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/**
 * A word inside `cmd` quotes reaches the program through the C runtime's rule, where a backslash before a quote
 * escapes it: the word's last backslashes are doubled so the closing quote stays a quote.
 */
function cmdWord(word: string): string {
  return CMD_PLAIN_WORD.test(word) ? word : `"${word.replace(TRAILING_BACKSLASHES, (run) => run + run)}"`;
}

function checkWord(word: string, what: string): void {
  if (word === '') {
    throw new UnknownSource(`${what} holds an empty word`);
  }
  if (word.includes('${')) {
    throw new UnknownSource(`${what} holds a variable other than ${PLUGIN_ROOT}, which Codex does not fill`);
  }
  if (POSIX_UNSAFE.some((character) => word.includes(character))) {
    throw new UnknownSource(`${what} holds a line break, which no command line carries`);
  }
  if (CMD_UNSAFE.some((character) => word.includes(character))) {
    throw new UnknownSource(`${what} holds a quote, a percent sign or an exclamation mark, which a cmd line cannot carry as text`);
  }
}

function commandLines(sourceWords: readonly string[], pluginRoot: string, what: string): Pick<CodexHookHandler, 'command' | 'commandWindows'> {
  const words = sourceWords.map((word) => word.replaceAll(PLUGIN_ROOT, pluginRoot));
  for (const word of words) {
    checkWord(word, what);
  }
  const program = words[0] ?? '';
  // `cmd /C "<line>"` keeps a line's quotes only when the line does not start with one.
  if (!CMD_PLAIN_WORD.test(program)) {
    throw new UnknownSource(`${what} starts with a program name that needs quotes on cmd`);
  }
  return { command: words.map(posixWord).join(' '), commandWindows: words.map(cmdWord).join(' ') };
}

function skippedHandler(event: string, group: SourceGroup, handler: SourceHandler, reason: SkipReason): SkippedHandler {
  return { event, ...(group.matcher === undefined ? {} : { matcher: group.matcher }), words: handler.words, reason };
}

interface Rewrite {
  readonly groups: readonly CodexMatcherGroup[];
  readonly skipped: readonly SkippedHandler[];
}

function rewriteEvent(event: SharedHookEvent, source: SourceEvent, pluginRoot: string): Rewrite {
  const groups: CodexMatcherGroup[] = [];
  const skipped: SkippedHandler[] = [];
  const limit = CONTEXT_EVENTS.includes(event) ? NO_CONTEXT_LIMIT : {};
  source.groups.forEach((group, groupIndex) => {
    const hooks: CodexHookHandler[] = [];
    group.handlers.forEach((handler, handlerIndex) => {
      if (handler.rewake) {
        skipped.push(skippedHandler(event, group, handler, 'rewake Codex lacks'));
        return;
      }
      const what = `${event} group ${groupIndex + 1}, handler ${handlerIndex + 1}`;
      hooks.push({ type: 'command', ...commandLines(handler.words, pluginRoot, what), timeout: handler.timeout, ...limit });
    });
    if (hooks.length > 0) {
      groups.push({ ...(group.matcher === undefined ? {} : { matcher: group.matcher }), hooks });
    }
  });
  return { groups, skipped };
}

function rewrite(events: readonly SourceEvent[], options: CodexHooksFileOptions): CodexHooksFileResult {
  const hooks: Partial<Record<SharedHookEvent, readonly CodexMatcherGroup[]>> = {};
  const skipped: SkippedHandler[] = [];
  for (const source of events) {
    const { name } = source;
    if (!isSharedHookEvent(name)) {
      for (const group of source.groups) {
        skipped.push(...group.handlers.map((handler) => skippedHandler(name, group, handler, 'event Codex lacks')));
      }
      continue;
    }
    const rewritten = rewriteEvent(name, source, options.pluginRoot);
    skipped.push(...rewritten.skipped);
    if (rewritten.groups.length > 0) {
      hooks[name] = rewritten.groups;
    }
  }
  const file: CodexHooksFile = { ...(options.description === undefined ? {} : { description: options.description }), hooks };
  return { ok: true, file, skipped };
}

/**
 * Rewrites teamrig's parsed hooks file for Codex: the events both have, one command line per shell with the plugin's
 * real path in it, each handler's own timeout, and the context limit off where the team rules and the inbox arrive.
 */
export function codexHooksFile(source: unknown, options: CodexHooksFileOptions): CodexHooksFileResult {
  // A relative path would be read from the folder the hook starts in, which is the project's, not the plugin's.
  if (!ABSOLUTE_PATH.test(options.pluginRoot)) {
    return { ok: false, reason: 'the plugin root is not an absolute path' };
  }
  try {
    return rewrite(readSource(source), options);
  } catch (error) {
    if (error instanceof UnknownSource) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}
