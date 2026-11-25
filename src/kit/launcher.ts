import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The kit launcher (T5278 design D, section 5): `<kit home>/bin/teamrig.mjs`, the one file every host's hook line and
 * every terminal's `teamrig` runs. A host trusts a hook line by its text, and this line names no version, so the
 * check moves here: before it runs a line of teamrig, it reads `current`, matches `current.json` against that
 * version's integrity list, keeps every path inside `versions/`, refuses a file the list does not name, and checks
 * each listed file (C2). A failure, or a crash in the code it runs, ends with the exit the call's event allows (C4):
 * a guard event is blocked, never let through.
 *
 * The file is copied as it is from the client's `dist/kit/launcher.js`, so it imports only Node's own modules: it runs
 * before any teamrig code is checked. A spec holds what it repeats from teamrig's own modules (the record names, the
 * version form and the list hash) equal to them.
 */

/** The launcher's own words, read and taken off before the CLI's: which entry script runs, and the host event. */
export const ENTRY_FLAG = '--launcher-entry';
export const EVENT_FLAG = '--launcher-event';

/** The entry scripts a hook line may name, by the word it names them with; `main` when it names none. */
export const LAUNCHER_ENTRIES: ReadonlyMap<string, string> = new Map([
  ['main', 'dist/cli/main.js'],
  ['guard-main', 'dist/cli/guard-main.js'],
]);

/** Where the build writes the integrity list, relative to a version folder (client-integrity.ts CLIENT_MANIFEST). */
export const LIST_PATH = 'dist/integrity.json';

/** The speed cache's name in a version folder (C6). */
export const VERIFIED_NAME = '.verified';

/** A release version as `current` names it (release-version.ts): no path, no `..`, nothing but `x.y.z`. */
const RELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** True when `text` is a version `current` may name. */
export function isRelease(text: string): boolean {
  return RELEASE.test(text);
}

/**
 * The events that warn and go on when the install is broken (C4): a broken install must not wedge a session, and a
 * missed one of these lets no tool call through. PostToolUse goes on too, as the call already ran.
 */
const CONTEXT_EVENTS: ReadonlySet<string> = new Set(['SessionStart', 'Stop', 'SubagentStop', 'Notification', 'PreCompact', 'SessionEnd']);
const AFTER_TOOL_EVENT = 'PostToolUse';

/** One entry of a folder, as the launcher walks it: a link counts as `other`, never as what it names. */
export interface LauncherEntry {
  readonly name: string;
  readonly kind: 'file' | 'folder' | 'other';
}

/** What a file's stats say, which the speed cache compares (C6); `ino` is 0 where the file system gives none. */
export interface LauncherStat {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ino: number;
}

/** The file system as the launcher reads it. Each read gives undefined, never a throw, for a missing path. */
export interface LauncherFiles {
  read(path: string): Promise<string | undefined>;
  realPath(path: string): Promise<string | undefined>;
  list(folder: string): Promise<readonly LauncherEntry[] | undefined>;
  stat(path: string): Promise<LauncherStat | undefined>;
  /** Writes by a temp file and a rename, so a reader sees the old text or the new, never half of one. */
  replace(path: string, text: string): Promise<void>;
}

/** How the install the launcher found compares with its records: the entry to run, or why none runs. */
export type InstallCheck = { readonly kind: 'intact'; readonly entry: string } | { readonly kind: 'broken'; readonly why: string };

/** The sha256 of a text with CRLF read as LF, as the build hashes each listed file (client-integrity.ts). */
export function textHash(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The list a version's `dist/integrity.json` holds, path to hash, or undefined when it is not one. */
export function parseList(text: string): ReadonlyMap<string, string> | undefined {
  const value = parseJson(text);
  const files = isRecord(value) ? value['files'] : undefined;
  if (!isRecord(files)) return undefined;
  const list = new Map<string, string>();
  for (const [path, hash] of Object.entries(files)) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return undefined;
    list.set(path, hash);
  }
  return list.size === 0 ? undefined : list;
}

/** True when `path` is `base` or below it; both are real paths. */
function isInside(base: string, path: string): boolean {
  const rest = relative(base, path);
  return rest === '' || (!isAbsolute(rest) && rest !== '..' && !rest.startsWith(`..${sep}`));
}

/** Every path below `folder`, relative with `/`, and its kind; a link is listed, never followed. */
async function walk(files: LauncherFiles, folder: string, prefix: string): Promise<{ readonly path: string; readonly kind: LauncherEntry['kind'] }[]> {
  const entries = (await files.list(folder)) ?? [];
  const found: { path: string; kind: LauncherEntry['kind'] }[] = [];
  for (const entry of entries) {
    const path = `${prefix}${entry.name}`;
    found.push({ path, kind: entry.kind });
    if (entry.kind === 'folder') found.push(...(await walk(files, join(folder, entry.name), `${path}/`)));
  }
  return found;
}

/** The cached stats of the files the last full check found intact, for one list and one launcher (C6). */
interface Verified {
  readonly listHash: string;
  readonly launcherHash: string;
  readonly files: ReadonlyMap<string, LauncherStat>;
}

function statOf(value: unknown): LauncherStat | undefined {
  if (!isRecord(value)) return undefined;
  const { size, mtimeMs, ino } = value;
  return typeof size === 'number' && typeof mtimeMs === 'number' && typeof ino === 'number' ? { size, mtimeMs, ino } : undefined;
}

/** The speed cache, or undefined when it is missing, unreadable or partial: that means a full check, never a pass. */
export function parseVerified(text: string | undefined): Verified | undefined {
  const value = text === undefined ? undefined : parseJson(text);
  if (!isRecord(value) || typeof value['listHash'] !== 'string' || typeof value['launcherHash'] !== 'string' || !isRecord(value['files'])) return undefined;
  const files = new Map<string, LauncherStat>();
  for (const [path, entry] of Object.entries(value['files'])) {
    const parsed = statOf(entry);
    if (parsed === undefined) return undefined;
    files.set(path, parsed);
  }
  return { listHash: value['listHash'], launcherHash: value['launcherHash'], files };
}

function verifiedText(verified: Verified): string {
  return `${JSON.stringify({ listHash: verified.listHash, launcherHash: verified.launcherHash, files: Object.fromEntries(verified.files) })}\n`;
}

/** True when a file's stats now are the ones the cache holds: a nonzero inode must match too. */
function sameStat(cached: LauncherStat | undefined, now: LauncherStat): boolean {
  return cached !== undefined && cached.size === now.size && cached.mtimeMs === now.mtimeMs && (cached.ino === 0 || now.ino === 0 || cached.ino === now.ino);
}

/** The first few paths of a list, for a one-line reason. */
function firstPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, 3).join(', ');
  return paths.length > 3 ? `${shown} and ${paths.length - 3} more` : shown;
}

/**
 * Checks the install `kitHome` names as current (design D section 5, steps 1-5) and gives the entry script to run.
 * The stray-file walk runs on every call; only the per-file hashes may come from the speed cache, which a changed
 * list or launcher misses whole.
 */
export async function checkInstall(files: LauncherFiles, kitHome: string, entryPath: string, launcherHash: string): Promise<InstallCheck> {
  const version = (await files.read(join(kitHome, 'current')))?.trim();
  if (version === undefined || !isRelease(version)) return { kind: 'broken', why: 'no teamrig installed' };
  const record = parseJson((await files.read(join(kitHome, 'current.json'))) ?? '');
  const versionFolder = join(kitHome, 'versions', version);
  const listText = await files.read(join(versionFolder, LIST_PATH));
  if (!isRecord(record) || record['version'] !== version || listText === undefined || record['listHash'] !== textHash(listText)) {
    return { kind: 'broken', why: 'install record changed' };
  }
  const list = parseList(listText);
  if (list === undefined) return { kind: 'broken', why: 'install record changed' };
  const versions = await files.realPath(join(kitHome, 'versions'));
  const realFolder = await files.realPath(versionFolder);
  const realEntry = await files.realPath(join(versionFolder, entryPath));
  if (versions === undefined || realFolder === undefined || realEntry === undefined || !isInside(versions, realFolder) || !isInside(realFolder, realEntry)) {
    return { kind: 'broken', why: 'teamrig files moved' };
  }
  const tree = await walk(files, versionFolder, '');
  const strays = tree.filter(
    (entry) => entry.path.split('/').includes('node_modules') || (entry.path.startsWith('dist/') && entry.path !== LIST_PATH && entry.kind !== 'folder' && (entry.kind !== 'file' || !list.has(entry.path))),
  );
  if (strays.length > 0) return { kind: 'broken', why: `teamrig files changed: ${firstPaths(strays.map((entry) => entry.path))} not in the list` };
  return checkListed(files, versionFolder, list, { listHash: textHash(listText), launcherHash }, entryPath);
}

/** Step 5: every listed file against its hash, through the speed cache, then the cache written for the next call. */
async function checkListed(files: LauncherFiles, folder: string, list: ReadonlyMap<string, string>, keys: Omit<Verified, 'files'>, entryPath: string): Promise<InstallCheck> {
  const cachePath = join(folder, VERIFIED_NAME);
  const cached = parseVerified(await files.read(cachePath));
  const usable = cached !== undefined && cached.listHash === keys.listHash && cached.launcherHash === keys.launcherHash ? cached.files : new Map<string, LauncherStat>();
  const changed: string[] = [];
  const stats = new Map<string, LauncherStat>();
  let hashed = false;
  for (const [path, hash] of list) {
    const full = join(folder, path);
    const now = await files.stat(full);
    if (now === undefined) {
      changed.push(path);
      continue;
    }
    if (!sameStat(usable.get(path), now)) {
      hashed = true;
      const text = await files.read(full);
      if (text === undefined || textHash(text) !== hash) {
        changed.push(path);
        continue;
      }
    }
    stats.set(path, now);
  }
  if (changed.length > 0) return { kind: 'broken', why: `teamrig files changed: ${firstPaths(changed)}` };
  if (hashed) await files.replace(cachePath, verifiedText({ ...keys, files: stats })).catch(() => undefined);
  return { kind: 'intact', entry: join(folder, entryPath) };
}

/** The launcher's reading of its words: its own two flags taken off, and the CLI's words that stay. */
export interface LauncherWords {
  readonly entry: string | undefined;
  readonly event: string | undefined;
  readonly rest: readonly string[];
}

/** Takes the launcher's own flags off the front of `words`; an entry word it does not know reads as undefined. */
export function readWords(words: readonly string[]): LauncherWords {
  let entry: string | undefined = LAUNCHER_ENTRIES.get('main');
  let event: string | undefined;
  let index = 0;
  while (index + 1 < words.length && (words[index] === ENTRY_FLAG || words[index] === EVENT_FLAG)) {
    const value = words[index + 1] ?? '';
    if (words[index] === ENTRY_FLAG) entry = LAUNCHER_ENTRIES.get(value);
    else event = value;
    index += 2;
  }
  return { entry, event, rest: words.slice(index) };
}

/** The exit a failed call ends with, and what it says (C4, with the owner's C5 default: a prompt is held back). */
export interface FailureExit {
  readonly code: 0 | 1 | 2;
  readonly note: string;
}

/**
 * The exit for a call that cannot run, or whose run crashed: a shell `teamrig` ends 1; a context event warns and goes
 * on; PostToolUse goes on and says redaction is off; every other hook event, an unknown one too, is blocked (2).
 */
export function failureExit(words: LauncherWords, why: string): FailureExit {
  const fix = `teamrig: ${why}; run teamrig kit install, or teamrig kit use <version>`;
  if (words.rest[0] !== 'hook') return { code: 1, note: fix };
  if (words.event !== undefined && CONTEXT_EVENTS.has(words.event)) return { code: 0, note: fix };
  if (words.event === AFTER_TOOL_EVENT) return { code: 0, note: `${fix}; secret redaction of this call's output is off` };
  return { code: 2, note: `${fix}; teamrig blocks this call until then` };
}

/** True when a hook call's own exit may reach the host as it is: 0 and 2 are the hook answers, anything else a crash. */
export function isHookAnswer(code: number): boolean {
  return code === 0 || code === 2;
}

/** The real file system, read as the launcher reads it. */
export const nodeLauncherFiles: LauncherFiles = {
  read: (path) => readFile(path, 'utf8').catch(() => undefined),
  realPath: (path) => realpath(path).catch(() => undefined),
  list: async (folder) => {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => undefined);
    return entries?.map((entry): LauncherEntry => ({ name: entry.name, kind: entry.isFile() ? 'file' : entry.isDirectory() ? 'folder' : 'other' }));
  },
  stat: async (path) => {
    const found = await lstat(path).catch(() => undefined);
    if (found === undefined || !found.isFile()) return undefined;
    const real = await stat(path);
    return { size: real.size, mtimeMs: real.mtimeMs, ino: real.ino };
  },
  replace: async (path, text) => {
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, text, 'utf8');
    await rename(temp, path);
  },
};

/** What a run of the launcher needs from the process it runs in. */
export interface LauncherProcess {
  readonly argv: readonly string[];
  readonly kitHome: string;
  readonly launcherHash: string;
  readonly files: LauncherFiles;
  /** Hands the CLI its words (the launcher's own taken off) and imports the entry script. */
  run(entry: string, words: readonly string[]): Promise<void>;
  writeError(text: string): void;
  /** Ends a hook call whose exit is no hook answer with `code` instead, crashes and exits on a guard event too. */
  onEnd(fix: (code: number) => number): void;
  exit(code: number): void;
}

/** One run: check the install, then run its entry; a failure or a crash ends with the event's failure exit. */
export async function launch(host: LauncherProcess): Promise<void> {
  const words = readWords(host.argv);
  const fail = (why: string): void => {
    const exit = failureExit(words, why);
    host.writeError(`${exit.note}\n`);
    host.exit(exit.code);
  };
  if (words.entry === undefined) return fail('the hook line names an entry script teamrig does not have');
  const check = await checkInstall(host.files, host.kitHome, words.entry, host.launcherHash);
  if (check.kind === 'broken') return fail(check.why);
  if (words.rest[0] === 'hook') {
    host.onEnd((code) => {
      if (isHookAnswer(code)) return code;
      const exit = failureExit(words, `teamrig ended with exit ${code}`);
      host.writeError(`${exit.note}\n`);
      return exit.code;
    });
  }
  try {
    await host.run(check.entry, words.rest);
  } catch (error) {
    fail(`teamrig could not start: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The kit home this launcher sits in: `<kit home>/bin/teamrig.mjs`. */
function kitHomeOf(script: string): string {
  return dirname(dirname(script));
}

/** The real process: run when Node runs this file itself, never when a spec imports it. */
async function main(script: string): Promise<void> {
  const launcherHash = textHash(readFileSync(script, 'utf8'));
  const head = process.argv.slice(0, 2);
  await launch({
    argv: process.argv.slice(2),
    kitHome: kitHomeOf(script),
    launcherHash,
    files: nodeLauncherFiles,
    run: async (entry, words) => {
      process.argv = [...head.slice(0, 1), entry, ...words];
      await import(pathToFileURL(entry).href);
    },
    writeError: (text) => process.stderr.write(text),
    onEnd: (fix) => {
      const crash = (error: unknown): void => {
        process.stderr.write(`teamrig: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
        process.exit();
      };
      process.on('uncaughtException', crash);
      process.on('unhandledRejection', crash);
      process.on('exit', (code) => {
        process.exitCode = fix(code);
      });
    },
    exit: (code) => process.exit(code),
  });
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && process.argv[1] === self) await main(self);
