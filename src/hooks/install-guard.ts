import { posix, win32 } from 'node:path';
import type { EditCall, HookEvent, HookReply, ShellCall } from '../ports/host/index.ts';
import { launch } from '../push-guard/launchers.ts';
import { Location } from '../push-guard/location.ts';
import { parseShell, type ShellDialect, type ShellWord } from '../push-guard/tokenizer.ts';
import { resolveLiteralVariables } from '../push-guard/variables.ts';
import { aliasFormOf, nativePathOf, samePathKey } from './path-spelling.ts';
import { refusal } from './permission.ts';
import { isPattern, REST, segmentRegExp, wordPathOf } from './shell-word-path.ts';

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

/** A folder's compare key as a pattern, each segment by its name or short name: `c:/+u/+(?:\.teamrig|te…~1)`. */
function folderKeySource(folderKey: string): string {
  const [head = '', ...rest] = folderKey.split('/');
  return [escaped(head), ...rest.map(segmentPattern)].join('/+');
}

/** A place's entry on a compare key, anchored to the folder's key: `c:/u/.teamrig/current`. */
function entryKeyPattern(folderKey: string, place: GuardedPlace): RegExp {
  return new RegExp(`^${folderKeySource(folderKey)}/+${entriesPattern(place)}(?:/|$)`, 'i');
}

/**
 * The guarded folder itself on a compare key (T5364 R1): one line that removes or moves it takes every entry at
 * once, the hook files the hosts start their guards from among them.
 */
function folderKeyPattern(folderKey: string): RegExp {
  return new RegExp(`^${folderKeySource(folderKey)}/*$`, 'i');
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

/** The guarded place a compare key is in, or is the folder of, or undefined. */
async function placeOfKeys(keys: readonly string[], env: InstallGuardEnv): Promise<GuardedPlace | undefined> {
  for (const place of env.places) {
    const patterns = (await folderKeysOf(place, env)).flatMap((folder) => [entryKeyPattern(folder, place), folderKeyPattern(folder)]);
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

/** The words of a reading, redirection targets included, as the tokenizer reads them (quotes and escapes gone). */
function shellWordsOf(reading: string, call: ShellCall): readonly ShellWord[] {
  return parseShell(reading, call.dialect).commands.flatMap((command) => [
    ...command.words,
    ...command.redirections.flatMap((redirection) => (redirection.target === undefined ? [] : [redirection.target])),
  ]);
}

/** The static words of a reading, redirection targets included, each as the shell would hand it on. */
function wordsOf(reading: string, call: ShellCall): readonly string[] {
  return shellWordsOf(reading, call).map((word) => word.text);
}

/** True when a word's segment can be the target's: a pattern that matches it, or its name, short name or trailing dots. */
function segmentReaches(segment: string, target: string, flags: string): boolean {
  return isPattern(segment) ? segmentRegExp(segment, flags).test(target) : new RegExp(`^${segmentPattern(target)}$`, flags).test(segment);
}

/**
 * True when a pattern path's segments can reach the target's: each of the target's segments matched in turn. A
 * segment the running shell ends (a substitution) reaches the target only in the place of its entry, so one right
 * after a guarded folder reaches its entries, but one after the home does not reach the kit's.
 */
function patternReaches(segments: readonly string[], target: readonly string[], flags: string): boolean {
  for (const [index, wanted] of target.entries()) {
    const segment = segments[index];
    if (segment === undefined) {
      return false;
    }
    // Only a folder a `cd` named puts one before others (`cd ~/$(x) && rm current`); it stands for one segment there.
    if (segment.includes(REST) && index === segments.length - 1) {
      return index === target.length - 1 && segmentReaches(segment, wanted, flags);
    }
    if (!segmentReaches(segment, wanted, flags)) {
      return false;
    }
  }
  return true;
}

/**
 * True when a pattern path can be the target folder itself (T5364 R1): as many segments, each able to match. A
 * glob may match the folder's name (`~/.t*`, `~\*`), but a substitution may not, so `~/$(x)` stays open: what it
 * holds is the computed-path class, which Phase 2's read-only install closes.
 */
function patternIsFolder(segments: readonly string[], target: readonly string[], flags: string): boolean {
  return (
    segments.length === target.length &&
    !segments.some((segment) => segment.includes(REST)) &&
    target.every((wanted, index) => segmentReaches(segments[index] ?? '', wanted, flags))
  );
}

/**
 * The guarded place a pattern path can reach, or undefined: its folder part up to the first mark resolved as a file
 * tool's path is (against the cwd, to its real form), then the rest walked segment by segment, `..` taking the one
 * before, and held against each guarded entry's segments and the folder itself (T5355 S2, T5364 R1). A `..` after
 * a segment the running shell ends stays inside it, as that may hold more than one.
 */
async function placeOfPattern(native: string, cwd: string, env: InstallGuardEnv): Promise<GuardedPlace | undefined> {
  const paths = pathsOf(env.platform);
  const mark = native.search(/[\u{E000}-\u{E002}]/u);
  const cut = Math.max(native.lastIndexOf('/', mark), native.lastIndexOf('\\', mark));
  const folder = paths.resolve(cwd, native.slice(0, cut + 1));
  const segments = ((await realKeyOf(folder, env)) ?? keyOf(folder, env)).split('/');
  for (const segment of native.slice(cut + 1).split(/[\\/]+/)) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (!(segments[segments.length - 1] ?? '').includes(REST)) {
        segments.splice(Math.max(1, segments.length - 1));
      }
      continue;
    }
    segments.push(segment);
  }
  const flags = env.platform === 'win32' ? 'i' : '';
  for (const place of env.places) {
    for (const folderKey of await folderKeysOf(place, env)) {
      const head = folderKey.split('/');
      if (patternIsFolder(segments, head, flags) || place.entries.some((entry) => patternReaches(segments, [...head, entry], flags))) {
        return place;
      }
    }
  }
  return undefined;
}

/**
 * The guarded place a word's path reaches from the folder it runs in, with how, or undefined: a static word as a
 * file tool's path, else as a pattern. The folder is a pattern too after a `cd` to one, and undefined after a `cd`
 * to one nothing is known of, where only an absolute path still names a place.
 */
async function wordReach(path: string, cwd: string | undefined, env: InstallGuardEnv): Promise<{ readonly place: GuardedPlace; readonly how: string } | undefined> {
  const paths = pathsOf(env.platform);
  const native = nativePathOf(path, env.platform);
  if (cwd === undefined && !paths.isAbsolute(native)) {
    return undefined;
  }
  const base = cwd ?? env.cwd;
  if (isPattern(path) || isPattern(base)) {
    // Joined as text, not resolved: a `..` must meet the folder's marks in the walk, never cancel them here.
    const whole = paths.isAbsolute(native) ? native : `${base}${paths.sep}${native}`;
    const place = await placeOfPattern(whole, base, env);
    return place === undefined ? undefined : { place, how: 'a word that only the running shell completes, inside it' };
  }
  if (env.platform === 'win32' && aliasFormOf(path) !== undefined) {
    const place = env.places.find((candidate) => namesPlacePart(path, candidate, env.platform));
    return place === undefined ? undefined : { place, how: 'a path to it in a spelling the guard cannot hold to one file' };
  }
  const absolute = paths.resolve(base, native);
  const real = await realKeyOf(absolute, env);
  const place = await placeOfKeys([keyOf(absolute, env), ...(real === undefined ? [] : [real])], env);
  return place === undefined ? undefined : { place, how: 'a path in it' };
}

/** A word as a folder command reads it: its path once the shell has read it, or only known when it runs. */
function locationWord(word: ShellWord, path: string | undefined): ShellWord {
  return path === undefined ? { text: word.text, dynamic: true } : { text: path, dynamic: false };
}

/** How deep the word pass follows shells that start shells, as the push guard does; past it the raw-text pass holds. */
const MAX_NESTING = 8;

/** What the word pass of one tool call carries into every line it reads. */
interface WordWalk {
  /** The tool's name, for the reason. */
  readonly tool: string;
  readonly env: InstallGuardEnv;
  /** The folder and path pairs already held, so a path a line repeats is resolved once. */
  readonly seen: Set<string>;
}

/** The guarded place a command's words and redirection targets reach from the folder it runs in, with how. */
async function commandReach(
  paths: readonly (string | undefined)[],
  at: string | undefined,
  walk: WordWalk,
): Promise<{ readonly place: GuardedPlace; readonly how: string } | undefined> {
  for (const path of paths) {
    const key = `${at ?? ''}\u{0}${path ?? ''}`;
    if (path === undefined || walk.seen.has(key)) {
      continue;
    }
    walk.seen.add(key);
    const reach = await wordReach(path, at, walk.env);
    if (reach !== undefined) {
      return reach;
    }
  }
  return undefined;
}

/**
 * The refusal of a script one of whose words reaches a guarded place once its shell has read it; see
 * {@link wordsReply}. A command that runs a line in a shell (`bash -c`, `pwsh -Command`, `cmd /c`, `eval`, a heredoc
 * into `bash`), as the push guard's {@link launch} reader finds it, has that line read the same way in its own
 * dialect (T5365 R4), from a child of the folder it starts in; one run in this same shell (`eval`) moves this one.
 */
async function scriptReply(script: string, dialect: ShellDialect, location: Location, depth: number, walk: WordWalk): Promise<HookReply | undefined> {
  if (depth > MAX_NESTING) {
    return undefined;
  }
  const { env } = walk;
  const wordEnv = { home: env.home, platform: env.platform, variables: env.variables };
  const parsed = parseShell(script, dialect);
  // A bash variable the line binds before it reads it (`X=~/.teamrig; rm $X/current`) holds that value (T5364 R3).
  const commands = dialect === 'bash' ? resolveLiteralVariables(parsed, env.home) : parsed.commands;
  for (const command of commands) {
    location.enter(command.subshells);
    const targets = command.redirections.flatMap((redirection) => (redirection.target === undefined ? [] : [redirection.target]));
    const paths = command.words.map((word) => wordPathOf(word, dialect, wordEnv));
    const reach = await commandReach([...paths, ...targets.map((word) => wordPathOf(word, dialect, wordEnv))], location.dir, walk);
    if (reach !== undefined) {
      return refusal(reasonOf(`this ${walk.tool} line names ${reach.how}, and a shell line's writes cannot be told from its reads`, reach.place));
    }
    const moved = location.apply(
      command.words.map((word, index) => locationWord(word, paths[index])),
      dialect,
    );
    const launched = moved ? undefined : launch(command.words, dialect, command.stdin);
    if (launched?.kind !== 'script') {
      continue;
    }
    const inner = location.child();
    launched.chdirs.forEach((chdir) => inner.moveTo(chdir, dialect));
    const nested = await scriptReply(launched.script.text, launched.dialect, inner, depth + 1, walk);
    if (nested !== undefined) {
      return nested;
    }
    if (launched.sameShell) {
      location.adopt(inner);
    }
  }
  return undefined;
}

/**
 * The refusal of a shell line one of whose words reaches a guarded place once the shell has read it (T5355 S1):
 * quotes and escapes removed, `~` and the environment's variables expanded, resolved against the folder the command
 * runs in, which a `cd`, `pushd` or `Set-Location` earlier in the line moves (T5364 R2), as the push guard's
 * {@link Location} follows it. This holds the spellings the line's raw text hides (`..`, a quote inside a name, a
 * glob, a path relative to any cwd), in the line and in each line a nested shell runs.
 */
async function wordsReply(call: ShellCall, cwd: string, env: InstallGuardEnv): Promise<HookReply | undefined> {
  const readings = call.readings.length === 0 && call.command !== undefined ? [call.command] : call.readings;
  const walk: WordWalk = { tool: call.name, env, seen: new Set<string>() };
  for (const reading of readings) {
    const reply = await scriptReply(reading, call.dialect, new Location(cwd, env.home, pathsOf(env.platform)), 0, walk);
    if (reply !== undefined) {
      return reply;
    }
  }
  return undefined;
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
  return wordsReply(call, cwd, env);
}
