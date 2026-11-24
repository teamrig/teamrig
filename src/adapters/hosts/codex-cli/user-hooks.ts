/**
 * teamrig's handlers in the person's own Codex CLI hooks file, `$CODEX_HOME/hooks.json` (`~/.codex` when unset).
 *
 * Codex 0.170.0 loads no plugin's hooks, so teamrig's must sit in the person's file beside their own
 * (`codex-rs/hooks/src/engine/discovery.rs`, tag rust-v0.170.0). A handler there has no field to tag it with
 * (`HookHandlerConfig` in `codex-rs/protocol/src/hooks.rs`), so teamrig's are told by their command: `node`, a
 * script ending `/dist/cli/main.js` or `/dist/cli/guard-main.js`, then `hook`, as `codexHooksFile` writes it. Each
 * merge takes those out and puts the current ones in, so an update replaces its own handlers and never touches the
 * person's.
 *
 * Codex runs a person's handler only once its definition's hash is trusted in `[hooks.state]` of `config.toml`, and
 * skips a changed one silently. This module never writes that trust: the person gives it in Codex's `/hooks`.
 */

import { posix, win32 } from 'node:path';
import { isRecord, type HostDeps, type HostUserHooks, type JsonRecord, type UserHooksAnswer, type UserHooksCounts } from '../../../plugin-api/index.ts';
import { withBooleanKey } from './config-toml.ts';
import { codexHooksFile, type SkippedHandler } from './hooks-file.ts';

/** Moves Codex's own folder (config, hooks, login) away from `~/.codex`. */
const HOME_VAR = 'CODEX_HOME';
const DEFAULT_HOME = '.codex';
const HOOKS_FILE = 'hooks.json';
const CONFIG_FILE = 'config.toml';

/** The top-level keys Codex reads in a hooks file; it refuses a file holding any other. */
const FILE_KEYS: readonly string[] = ['description', 'hooks'];

/** The scripts of teamrig's hook commands, as the plugin's hooks file names them below the plugin root. */
const TEAMRIG_SCRIPT = /\/dist\/cli\/(?:main|guard-main)\.js$/u;
const POSIX_PLAIN = /[A-Za-z0-9_@%+=:,./-]/u;

const AFTER_WRITE: readonly string[] = [
  'Codex runs a new or changed hook only once you trust it: open /hooks in Codex and trust teamrig\'s hooks.',
  'Each teamrig update changes them: run this command again after every update, then trust them again in /hooks.',
];

class BadFile extends Error {}

type Groups = readonly JsonRecord[];

/**
 * The words of a command line as `posixWord` writes them: plain characters, `'...'` quoting and `\'` between quotes.
 * Undefined for any other line, which is then not teamrig's.
 */
function posixWords(line: string): readonly string[] | undefined {
  const words: string[] = [];
  let word = '';
  let index = 0;
  while (index < line.length) {
    const character = line.charAt(index);
    if (character === ' ') {
      if (word === '') return undefined;
      words.push(word);
      word = '';
      index += 1;
    } else if (character === "'") {
      const end = line.indexOf("'", index + 1);
      if (end === -1) return undefined;
      word += line.slice(index + 1, end);
      index = end + 1;
    } else if (character === '\\' && line.charAt(index + 1) === "'") {
      word += "'";
      index += 2;
    } else if (POSIX_PLAIN.test(character)) {
      word += character;
      index += 1;
    } else {
      return undefined;
    }
  }
  if (word === '') return undefined;
  words.push(word);
  return words;
}

/** The handler's identity when it is teamrig's: its event, matcher, script and words; undefined for the person's own. */
function teamrigKey(event: string, matcher: unknown, handler: unknown): string | undefined {
  if (!isRecord(handler) || typeof handler['command'] !== 'string') return undefined;
  const words = posixWords(handler['command']);
  const script = words?.[1];
  if (words === undefined || script === undefined || words[0] !== 'node' || !TEAMRIG_SCRIPT.test(script) || words[2] !== 'hook') return undefined;
  const scriptName = script.slice(script.lastIndexOf('/') + 1);
  return JSON.stringify([event, typeof matcher === 'string' ? matcher : null, scriptName, ...words.slice(2)]);
}

function groupsOf(value: unknown, event: string): Groups {
  if (!Array.isArray(value)) throw new BadFile(`its ${event} entry is not a list`);
  return value.map((group, index) => {
    if (!isRecord(group) || !Array.isArray(group['hooks'])) throw new BadFile(`its ${event} group ${index + 1} has no list of hooks`);
    return group;
  });
}

function eventsOf(current: JsonRecord): ReadonlyMap<string, Groups> {
  const unknown = Object.keys(current).find((key) => !FILE_KEYS.includes(key));
  if (unknown !== undefined) throw new BadFile(`it holds the key ${unknown}, which Codex refuses in a hooks file`);
  const hooks = current['hooks'] ?? {};
  if (!isRecord(hooks)) throw new BadFile('its hooks are not a JSON object');
  return new Map(Object.entries(hooks).map(([event, value]) => [event, groupsOf(value, event)]));
}

function handlersOf(group: JsonRecord): readonly unknown[] {
  const hooks = group['hooks'];
  return Array.isArray(hooks) ? hooks : [];
}

/** Each of teamrig's handlers in these groups, by its key (a repeat gets its count), as JSON text. */
function teamrigHandlers(event: string, groups: Groups): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const group of groups) {
    for (const handler of handlersOf(group)) {
      const key = teamrigKey(event, group['matcher'], handler);
      if (key === undefined) continue;
      let counted = key;
      for (let repeat = 2; found.has(counted); repeat += 1) counted = `${key}#${repeat}`;
      found.set(counted, JSON.stringify(handler));
    }
  }
  return found;
}

/** The person's own groups: teamrig's handlers taken out, and a group that held only those gone with them. */
function personsGroups(event: string, groups: Groups): Groups {
  return groups.flatMap((group) => {
    const handlers = handlersOf(group);
    const kept = handlers.filter((handler) => teamrigKey(event, group['matcher'], handler) === undefined);
    if (kept.length === handlers.length) return [group];
    return kept.length === 0 ? [] : [{ ...group, hooks: kept }];
  });
}

function countsOf(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): UserHooksCounts {
  let inserted = 0;
  let unchanged = 0;
  let changed = 0;
  for (const [key, handler] of after) {
    const old = before.get(key);
    if (old === undefined) inserted += 1;
    else if (old === handler) unchanged += 1;
    else changed += 1;
  }
  const removed = [...before.keys()].filter((key) => !after.has(key)).length;
  return { inserted, unchanged, changed, removed };
}

function skippedLine(skipped: SkippedHandler): string {
  const where = skipped.matcher === undefined ? skipped.event : `${skipped.event} (${skipped.matcher})`;
  return `${where}: ${skipped.words.join(' ')}: ${skipped.reason}`;
}

function allOf(events: ReadonlyMap<string, Groups>): ReadonlyMap<string, string> {
  return new Map([...events].flatMap(([event, groups]) => [...teamrigHandlers(event, groups)]));
}

function merged(current: JsonRecord, source: unknown, pluginRoot: string): UserHooksAnswer {
  const events = eventsOf(current);
  const built = codexHooksFile(source, { pluginRoot });
  if (!built.ok) return { ok: false, problem: `teamrig's hooks file cannot be written for Codex: ${built.reason}` };
  const ours = new Map<string, Groups>(Object.entries(built.file.hooks).map(([event, groups]) => [event, groups.map((group) => ({ ...group }))]));
  const hooks: Record<string, Groups> = {};
  for (const event of new Set([...events.keys(), ...ours.keys()])) {
    const groups = [...personsGroups(event, events.get(event) ?? []), ...(ours.get(event) ?? [])];
    // An empty list the person wrote stays; one left empty by taking teamrig's handlers out goes.
    if (groups.length > 0 || events.get(event)?.length === 0) hooks[event] = groups;
  }
  const counts = countsOf(allOf(events), allOf(ours));
  const same = counts.inserted + counts.changed + counts.removed === 0;
  return { ok: true, value: { file: same ? undefined : { ...current, hooks }, counts, skipped: built.skipped.map(skippedLine) } };
}

/**
 * Interactive shells off in the person's config.toml, for the sessions they start outside teamrig's launcher, which
 * passes the same key (launch-args.ts `NO_TTY_SHELLS`): a line sent into a tty shell runs no PreToolUse hook (T5270 F2).
 */
const NO_TTY = { table: 'features', key: 'unified_exec_tty' } as const;

/** The Codex CLI port of the person's hooks file. */
export function codexUserHooks(env: HostDeps['env'], platform: HostDeps['platform']): HostUserHooks {
  const path = platform === 'win32' ? win32 : posix;
  const codexHome = (userHome: string): string => {
    const moved = env[HOME_VAR]?.trim();
    return moved ? moved : path.join(userHome, DEFAULT_HOME);
  };
  return {
    host: 'codex',
    file: (userHome) => path.join(codexHome(userHome), HOOKS_FILE),
    configLines: [
      {
        file: (userHome) => path.join(codexHome(userHome), CONFIG_FILE),
        setting: `[${NO_TTY.table}] ${NO_TTY.key} = false`,
        merge: (current) => {
          const edit = withBooleanKey(current, NO_TTY.table, NO_TTY.key, false);
          return edit.ok ? edit : { ok: false, problem: `the Codex config is not one teamrig can set ${NO_TTY.key} in: ${edit.problem}` };
        },
      },
    ],
    merge: (current, source, pluginRoot) => {
      try {
        return merged(current, source, pluginRoot);
      } catch (error) {
        if (error instanceof BadFile) return { ok: false, problem: `the Codex hooks file is not one teamrig can merge into: ${error.message}` };
        throw error;
      }
    },
    afterWrite: AFTER_WRITE,
  };
}
