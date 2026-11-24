import { posix, win32 } from 'node:path';
import type { EditCall, HookEvent, HookReply, ShellCall } from '../ports/host/index.ts';
import { parseShell } from '../push-guard/tokenizer.ts';
import { aliasFormOf, nativePathOf, samePathKey } from './path-spelling.ts';
import { refusal } from './permission.ts';

/**
 * The install guard (T5278 C1, security verdict T5292): every session's guards run from teamrig's own install (the
 * kit's versions, the `current` pointer, its bin and records) and a host starts them from its hook files (Codex CLI's
 * hooks.json and config.toml). A session that rewrites either turns every guard off for the whole team, so the guard
 * refuses a session's own write of a guarded place: a file tool whose path reaches one by any spelling (an 8.3 short
 * name, trailing dots, a Git Bash drive, a link), and a shell line naming one at all, since a shell line's writes cannot
 * be told from its reads (the Read tool stays open). The place's other entries (the kit's `teams/`) stay open. Like the
 * pass-record guard it reads only the call: a script the session writes and starts still reaches the files, as
 * sessions and the owner share one account (stopgap T791).
 */

/** A folder whose named entries only teamrig writes. */
export interface GuardedPlace {
  /** The folder, absolute. */
  readonly folder: string;
  /** The names in it the guard keeps, each with all it holds. */
  readonly entries: readonly string[];
  /** What the place is, for the reason: `the teamrig install`. */
  readonly what: string;
  /** What writes it instead, for the reason: `` `teamrig setup hooks` ``. */
  readonly writer: string;
}

export interface InstallGuardEnv {
  /** The folder the call runs in when the event names none. */
  readonly cwd: string;
  readonly home: string;
  readonly platform: NodeJS.Platform;
  /** The environment the call's shell starts with: a variable that holds a guarded folder spells it too. */
  readonly variables: Readonly<Record<string, string | undefined>>;
  readonly places: readonly GuardedPlace[];
  /** The real path of an existing path (links and case resolved), or undefined when nothing is there. */
  readonly canonical: (path: string) => Promise<string | undefined>;
}

/** The path functions of the platform. */
function pathsOf(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix;
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A path segment as a pattern: its name, or its 8.3 short name (`.teamrig` is `TEAMRI~1`, `current.json` is
 * `CURREN~1.JSO`), with the trailing dots Windows drops. Node's real path gives a short name back unchanged, so the
 * guard must know it by its form.
 */
export function segmentPattern(name: string): string {
  const stripped = name.replace(/^\.+/, '');
  const dot = name.startsWith('.') ? -1 : stripped.lastIndexOf('.');
  const base = dot > 0 ? stripped.slice(0, dot) : stripped;
  const extension = dot > 0 ? `\\.${escaped(stripped.slice(dot + 1, dot + 4))}` : '';
  return `(?:${escaped(name)}|${escaped(base.slice(0, 2))}[^\\\\/.\\s'"]*~\\d+${extension})\\.*`;
}

/** A path's compare key with no trailing slash, so a root (`c:/`, `/`) prefixes its children as `<key>/`. */
function keyOf(path: string, env: InstallGuardEnv): string {
  return samePathKey(nativePathOf(path, env.platform), env.cwd, env.platform).replace(/\/+$/, '');
}

/** True when the key is the folder's or under it. */
function isWithin(key: string, folder: string): boolean {
  return key === folder || key.startsWith(`${folder}/`);
}

/** The pattern of a place's entries, each a whole segment, with what follows it. */
function entriesPattern(place: GuardedPlace): string {
  return `(?:${place.entries.map(segmentPattern).join('|')})`;
}

/** A segment ends at a separator, a character a name cannot hold, or the end. */
const SEGMENT_END = '(?=[\\\\/]|[^\\w.~-]|$)';

/** A place's entry on a compare key, anchored to the folder's key: `c:/u/.teamrig/current`. */
function entryKeyPattern(folderKey: string, place: GuardedPlace): RegExp {
  const [head = '', ...rest] = folderKey.split('/');
  const folder = [escaped(head), ...rest.map(segmentPattern)].join('/+');
  return new RegExp(`^${folder}/+${entriesPattern(place)}(?:/|$)`, 'i');
}

/** The folder spellings a place is reached by, as given and as its real path. */
async function folderKeysOf(place: GuardedPlace, env: InstallGuardEnv): Promise<readonly string[]> {
  const real = await env.canonical(place.folder);
  const keys = [keyOf(place.folder, env), ...(real === undefined ? [] : [keyOf(real, env)])];
  return [...new Set(keys)];
}

/** The key of the path's real form: the real path of its deepest existing folder, with the rest as written. */
async function realKeyOf(absolute: string, env: InstallGuardEnv): Promise<string | undefined> {
  const paths = pathsOf(env.platform);
  const rest: string[] = [];
  let at = absolute;
  for (;;) {
    const real = await env.canonical(at);
    if (real !== undefined) {
      return keyOf(paths.join(real, ...rest), env);
    }
    const parent = paths.dirname(at);
    if (parent === at) {
      return undefined;
    }
    rest.unshift(paths.basename(at));
    at = parent;
  }
}

/** The guarded place a compare key is in, or undefined. */
async function placeOfKeys(keys: readonly string[], env: InstallGuardEnv): Promise<GuardedPlace | undefined> {
  for (const place of env.places) {
    const patterns = (await folderKeysOf(place, env)).map((folder) => entryKeyPattern(folder, place));
    if (keys.some((key) => patterns.some((pattern) => pattern.test(key)))) {
      return place;
    }
  }
  return undefined;
}

/** True when a segment of the path is a place's folder name or entry, by name or short name. */
function namesPlacePart(path: string, place: GuardedPlace, platform: NodeJS.Platform): boolean {
  const names = [pathsOf(platform).basename(place.folder), ...place.entries];
  const pattern = new RegExp(`^(?:${names.map(segmentPattern).join('|')})$`, 'i');
  return path.split(/[\\/]+/).some((segment) => pattern.test(segment.split(':')[0] ?? ''));
}

function reasonOf(reach: string, place: GuardedPlace): string {
  return (
    `teamrig install guard: ${reach}. ${place.what} (${place.folder}) is what every session's guards run from, so only ` +
    `teamrig writes it: ${place.writer}. Read it with the Read tool; do not retry this or route around it: the lead ` +
    'takes the change.'
  );
}

/** The refusal of a file tool's call when a file it writes is in a guarded place, else none. */
async function editReply(call: EditCall, cwd: string, env: InstallGuardEnv): Promise<HookReply | undefined> {
  for (const { path } of call.files) {
    if (path === undefined) {
      continue;
    }
    const alias = env.platform === 'win32' ? aliasFormOf(path) : undefined;
    if (alias !== undefined) {
      const named = env.places.find((place) => namesPlacePart(path, place, env.platform));
      if (named !== undefined) {
        return refusal(reasonOf(`this ${call.name} names ${path} through ${alias}, a spelling the guard cannot hold to one file`, named));
      }
      continue;
    }
    const absolute = pathsOf(env.platform).resolve(cwd, nativePathOf(path, env.platform));
    const real = await realKeyOf(absolute, env);
    const place = await placeOfKeys([keyOf(absolute, env), ...(real === undefined ? [] : [real])], env);
    if (place !== undefined) {
      return refusal(reasonOf(`this ${call.name} writes ${path}`, place));
    }
  }
  return undefined;
}

/** The ways a shell line spells a guarded folder, as patterns: its path, `~`, a variable that holds it, or from the cwd. */
function folderSpellings(folderKey: string, cwd: string, env: InstallGuardEnv): readonly string[] {
  const segments = folderKey.split('/');
  const tail = (from: number): string => segments.slice(from).map((segment) => `[\\\\/]+${segmentPattern(segment)}`).join('');
  const [head = ''] = segments;
  const drive = /^([a-z]):$/i.exec(head);
  const spellings = [`${drive === null ? escaped(head) : `(?:${escaped(head)}|/${drive[1] ?? ''})`}${tail(1)}`];
  const below = (ancestor: string): number | undefined =>
    isWithin(folderKey, ancestor) ? (ancestor === '' ? 1 : ancestor.split('/').length) : undefined;
  const home = below(keyOf(env.home, env));
  if (home !== undefined) {
    spellings.push(`~${tail(home)}`);
  }
  const delimiter = pathsOf(env.platform).delimiter;
  for (const [name, value] of Object.entries(env.variables)) {
    if (value === undefined || value === '' || value.includes(delimiter) || !pathsOf(env.platform).isAbsolute(nativePathOf(value, env.platform))) {
      continue;
    }
    const from = below(keyOf(value, env));
    if (from !== undefined) {
      const word = escaped(name);
      spellings.push(`(?:\\$${word}|\\$\\{${word}\\}|%${word}%|\\$env:${word})${tail(from)}`);
    }
  }
  const here = below(keyOf(cwd, env));
  if (here !== undefined && here < segments.length) {
    spellings.push(`(?<![\\w.~$%:\\\\/-])(?:\\.[\\\\/]+)?${segments.slice(here).map(segmentPattern).join('[\\\\/]+')}`);
  }
  return spellings;
}

/** The static words of a reading, redirection targets included, each as the shell would hand it on. */
function wordsOf(reading: string, call: ShellCall): readonly string[] {
  return parseShell(reading, call.dialect).commands.flatMap((command) => [
    ...command.words.map((word) => word.text),
    ...command.redirections.flatMap((redirection) => (redirection.target === undefined ? [] : [redirection.target.text])),
  ]);
}

/** Why a shell line reaches a guarded place, or undefined when it names none. */
async function shellReach(call: ShellCall, cwd: string, place: GuardedPlace, env: InstallGuardEnv): Promise<string | undefined> {
  const cwdKey = keyOf(cwd, env);
  const readings = call.readings.length === 0 && call.command !== undefined ? [call.command] : call.readings;
  for (const folderKey of await folderKeysOf(place, env)) {
    if (entryKeyPattern(folderKey, place).test(cwdKey)) {
      return `this ${call.name} line runs in ${cwd}`;
    }
    const spellings = `(?:${folderSpellings(folderKey, cwd, env).join('|')})`;
    const entry = new RegExp(`${spellings}[\\\\/]+${entriesPattern(place)}${SEGMENT_END}`, 'i');
    if (readings.some((reading) => entry.test(reading))) {
      return `this ${call.name} line names a path in it, and a shell line's writes cannot be told from its reads`;
    }
    const folder = new RegExp(`${spellings}${SEGMENT_END}`, 'i');
    const named = cwdKey === folderKey || readings.some((reading) => folder.test(reading));
    const word = new RegExp(`^(?:\\.[\\\\/]+)?${entriesPattern(place)}(?:[\\\\/]|$)`, 'i');
    if (named && readings.some((reading) => wordsOf(reading, call).some((text) => word.test(text)))) {
      return `this ${call.name} line names the folder and one of its guarded entries, and a shell line's writes cannot be told from its reads`;
    }
  }
  return undefined;
}

/** The reply to a shell or file tool call before it runs: a refusal when it reaches a guarded place, else none. */
export async function installGuardReply(event: HookEvent, env: InstallGuardEnv): Promise<HookReply | undefined> {
  const { call } = event;
  const cwd = event.cwd ?? env.cwd;
  if (call?.kind === 'edit') {
    return editReply(call, cwd, env);
  }
  if (call?.kind !== 'shell' || call.command === undefined) {
    return undefined;
  }
  for (const place of env.places) {
    const reach = await shellReach(call, cwd, place, env);
    if (reach !== undefined) {
      return refusal(reasonOf(reach, place));
    }
  }
  return undefined;
}
