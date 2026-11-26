/**
 * teamrig's handlers in the person's own Codex CLI hooks file, `$CODEX_HOME/hooks.json` (`~/.codex` when unset).
 *
 * Codex 0.170.0 loads no plugin's hooks, so teamrig's must sit in the person's file beside their own
 * (`codex-rs/hooks/src/engine/discovery.rs`, tag rust-v0.170.0). A handler there has no field to tag it with
 * (`HookHandlerConfig` in `codex-rs/protocol/src/hooks.rs`), so teamrig's are told by their command: `node` and the
 * kit launcher with its entry and event words, as `codexHooksFile` writes it, or, as releases before the launcher
 * wrote it, `node` and an entry script below a plugin folder; then `hook`. Both forms of one handler have one key, so
 * the move from a plugin folder to the launcher counts as a change. Each merge takes those out and puts the current
 * ones in, so it never touches the person's.
 *
 * Codex runs a person's handler only once its definition's hash is trusted in `[hooks.state]` of `config.toml`, and
 * skips a changed one silently. This module never writes that trust: the person gives it in Codex's `/hooks`.
 */

import { posix, win32 } from 'node:path';
import {
  isRecord,
  skippedUserHookLine,
  userHooksCounts,
  type HookLauncher,
  type HostDeps,
  type HostUserHooks,
  type JsonRecord,
  type UserHooksAnswer,
} from '../../../plugin-api/index.ts';
import { withBooleanKey, withBooleanKeyInEach, withBooleanKeyWhereSet } from './config-toml.ts';
import { codexHomeOf } from './codex-home.ts';
import { codexHooksFile, type SkippedHandler } from './hooks-file.ts';

const HOOKS_FILE = 'hooks.json';
const CONFIG_FILE = 'config.toml';

/** The top-level keys Codex reads in a hooks file; it refuses a file holding any other. */
const FILE_KEYS: readonly string[] = ['description', 'hooks'];

const POSIX_PLAIN = /[A-Za-z0-9_@%+=:,./-]/u;

const AFTER_WRITE: readonly string[] = [
  'Codex runs a new or changed hook only once you trust it: open /hooks in Codex and trust teamrig\'s hooks.',
  'They run teamrig through its kit launcher, which names no version: a teamrig update leaves them as they are, so the trust holds.',
];

class BadFile extends Error { }

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

/** A path's last part, by either separator: a Windows line names the launcher with backslashes. */
function lastPart(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

interface TeamrigLine {
  /** The launcher's word for the entry script the line runs. */
  readonly entry: string;
  /** The CLI's words, from `hook` on. */
  readonly rest: readonly string[];
}

/**
 * The entry and the CLI's words of a line's words past `node`: `<launcher> <entry flag> <entry> <event flag> <event>
 * <words>` in the launcher form, `<folder>/<entry script> <words>` in the plugin-folder form; undefined for any other.
 */
function teamrigLine(words: readonly string[], launcher: HookLauncher): TeamrigLine | undefined {
  const [script, ...after] = words;
  if (script === undefined) return undefined;
  if (lastPart(script) === lastPart(launcher.path)) {
    const [entryFlag, entry, eventFlag, event, ...rest] = after;
    const known = entry !== undefined && [...launcher.entries.values()].includes(entry);
    return entryFlag === launcher.entryFlag && eventFlag === launcher.eventFlag && event !== undefined && known ? { entry, rest } : undefined;
  }
  const below = [...launcher.entries].find(([path]) => script.endsWith(`/${path}`));
  return below === undefined ? undefined : { entry: below[1], rest: after };
}

/** The handler's identity when it is teamrig's: its event, matcher, entry and words; undefined for the person's own. */
function teamrigKey(event: string, matcher: unknown, handler: unknown, launcher: HookLauncher): string | undefined {
  if (!isRecord(handler) || typeof handler['command'] !== 'string') return undefined;
  const words = posixWords(handler['command']);
  if (words === undefined || words[0] !== 'node') return undefined;
  const line = teamrigLine(words.slice(1), launcher);
  if (line === undefined || line.rest[0] !== 'hook') return undefined;
  return JSON.stringify([event, typeof matcher === 'string' ? matcher : null, line.entry, ...line.rest]);
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
function teamrigHandlers(event: string, groups: Groups, launcher: HookLauncher): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const group of groups) {
    for (const handler of handlersOf(group)) {
      const key = teamrigKey(event, group['matcher'], handler, launcher);
      if (key === undefined) continue;
      let counted = key;
      for (let repeat = 2; found.has(counted); repeat += 1) counted = `${key}#${repeat}`;
      found.set(counted, JSON.stringify(handler));
    }
  }
  return found;
}

/** The person's own groups: teamrig's handlers taken out, and a group that held only those gone with them. */
function personsGroups(event: string, groups: Groups, launcher: HookLauncher): Groups {
  return groups.flatMap((group) => {
    const handlers = handlersOf(group);
    const kept = handlers.filter((handler) => teamrigKey(event, group['matcher'], handler, launcher) === undefined);
    if (kept.length === handlers.length) return [group];
    return kept.length === 0 ? [] : [{ ...group, hooks: kept }];
  });
}

function allOf(events: ReadonlyMap<string, Groups>, launcher: HookLauncher): ReadonlyMap<string, string> {
  return new Map([...events].flatMap(([event, groups]) => [...teamrigHandlers(event, groups, launcher)]));
}

function merged(current: JsonRecord, source: unknown, launcher: HookLauncher): UserHooksAnswer {
  const events = eventsOf(current);
  const built = codexHooksFile(source, { launcher });
  if (!built.ok) return { ok: false, problem: `teamrig's hooks file cannot be written for Codex: ${built.reason}` };
  const ours = new Map<string, Groups>(Object.entries(built.file.hooks).map(([event, groups]) => [event, groups.map((group) => ({ ...group }))]));
  return rewritten(current, events, ours, launcher, built.skipped.map(skippedUserHookLine));
}

/** The person's file with teamrig's handlers taken out and none put back: what `kit uninstall` writes. */
function removed(current: JsonRecord, launcher: HookLauncher): UserHooksAnswer {
  return rewritten(current, eventsOf(current), new Map(), launcher, []);
}

/** The person's groups of each event, then `ours`, with the counts from teamrig's handlers before to `ours`. */
function rewritten(current: JsonRecord, events: ReadonlyMap<string, Groups>, ours: ReadonlyMap<string, Groups>, launcher: HookLauncher, skipped: readonly string[]): UserHooksAnswer {
  const hooks: Record<string, Groups> = {};
  for (const event of new Set([...events.keys(), ...ours.keys()])) {
    const groups = [...personsGroups(event, events.get(event) ?? [], launcher), ...(ours.get(event) ?? [])];
    // An empty list the person wrote stays; one left empty by taking teamrig's handlers out goes.
    if (groups.length > 0 || events.get(event)?.length === 0) hooks[event] = groups;
  }
  const counts = userHooksCounts(allOf(events, launcher), allOf(ours, launcher));
  const same = counts.inserted + counts.changed + counts.removed === 0;
  return { ok: true, value: { file: same ? undefined : { ...current, hooks }, counts, skipped } };
}

/** The answer of an edit of the person's file, or what in the file stops it. */
function readable(what: string, edit: () => UserHooksAnswer): UserHooksAnswer {
  try {
    return edit();
  } catch (error) {
    if (error instanceof BadFile) return { ok: false, problem: `the Codex hooks file is not one teamrig can ${what}: ${error.message}` };
    throw error;
  }
}

/**
 * Interactive shells off in the person's config.toml, for the sessions they start outside teamrig's launcher, which
 * passes the same key (launch-args.ts `NO_TTY_SHELLS`): a line sent into a tty shell runs no PreToolUse hook (T5270 F2).
 */
const NO_TTY = { table: 'features', key: 'unified_exec_tty' } as const;

/**
 * Codex's named profiles: it applies a profile's `features` after the root ones (`features/src/lib.rs`), so the key
 * is kept off in each profile that sets it as well as at the root; none is added where a profile sets nothing.
 */
const PROFILES = 'profiles';

/**
 * Codex 0.171's named profiles: `$CODEX_HOME/<name>.config.toml`, picked by `--profile <name>` and layered over
 * config.toml, so one turning the key on beats the root's off (T5361 results.md, case C). The key is turned off where
 * a profile sets it; a profile that sets nothing keeps the root's off, so none is added.
 */
const PROFILE_FILE_END = `.${CONFIG_FILE}`;

function isProfileFile(name: string): boolean {
  return name.length > PROFILE_FILE_END.length && name.endsWith(PROFILE_FILE_END);
}

/** The Codex CLI port of the person's hooks file. */
export function codexUserHooks(env: HostDeps['env'], platform: HostDeps['platform']): HostUserHooks {
  const path = platform === 'win32' ? win32 : posix;
  const codexHome = codexHomeOf(env, platform);
  return {
    host: 'codex',
    file: (userHome) => path.join(codexHome(userHome), HOOKS_FILE),
    configLines: [
      {
        file: (userHome) => path.join(codexHome(userHome), CONFIG_FILE),
        setting: `[${NO_TTY.table}] ${NO_TTY.key} = false, and the same in each [${PROFILES}.<name>.${NO_TTY.table}] that turns it on`,
        merge: (current) => {
          const root = withBooleanKey(current, NO_TTY.table, NO_TTY.key, false);
          const edit = root.ok ? withBooleanKeyInEach(root.text ?? current, PROFILES, `${NO_TTY.table}.${NO_TTY.key}`, false) : root;
          if (!edit.ok) return { ok: false, problem: `the Codex config is not one teamrig can set ${NO_TTY.key} in: ${edit.problem}` };
          return { ok: true, text: edit.text ?? (root.ok ? root.text : undefined) };
        },
      },
    ],
    configFileSets: [
      {
        folder: codexHome,
        holds: isProfileFile,
        setting: `[${NO_TTY.table}] ${NO_TTY.key} = false where the profile sets it`,
        merge: (current) => {
          const edit = withBooleanKeyWhereSet(current, NO_TTY.table, NO_TTY.key, false);
          return edit.ok ? edit : { ok: false, problem: `the Codex profile is not one teamrig can set ${NO_TTY.key} in: ${edit.problem}` };
        },
      },
    ],
    // The plugin folder is never written: a Codex line runs the kit launcher, so a run that names none is refused.
    merge: (current, source, _pluginRoot, launcher) => {
      if (launcher === undefined) return { ok: false, problem: "teamrig's Codex hooks run from the kit launcher, and this run names none" };
      return readable('merge into', () => merged(current, source, launcher));
    },
    kitLauncher: { remove: (current, launcher) => readable('take its handlers out of', () => removed(current, launcher)) },
    afterWrite: AFTER_WRITE,
  };
}
