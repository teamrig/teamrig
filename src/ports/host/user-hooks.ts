import type { JsonRecord } from '../../core/guards.ts';

/** How many of teamrig's handlers a merge adds, keeps as they were, rewrites and takes out. */
export interface UserHooksCounts {
  readonly inserted: number;
  readonly unchanged: number;
  readonly changed: number;
  readonly removed: number;
}

/** A merged hooks file, or none when the file already reads this way. */
export interface UserHooksPlan {
  /** The file to write; undefined when nothing changes. */
  readonly file: JsonRecord | undefined;
  readonly counts: UserHooksCounts;
  /** Each of teamrig's handlers the host cannot run, with why: told to the person, never dropped silently. */
  readonly skipped: readonly string[];
}

/** A plan, or why the file as it is cannot be merged: a problem the core words as a refusal. */
export type UserHooksAnswer = { readonly ok: true; readonly value: UserHooksPlan } | { readonly ok: false; readonly problem: string };

/** A config file's new text, undefined when it already reads so, or why the file as it is cannot be edited. */
export type ConfigLinesAnswer = { readonly ok: true; readonly text: string | undefined } | { readonly ok: false; readonly problem: string };

/**
 * A setting teamrig's hooks need in the host's own config file to guard every call, such as a host's interactive
 * shells off: set by `setup hooks` with the hooks, every other line of the file kept as it was.
 */
export interface HostConfigLines {
  /** The config file the host reads for the person whose home folder is `userHome`. */
  file(userHome: string): string;
  /** The setting as the person reads it in the file, such as `[features] unified_exec_tty = false`. */
  readonly setting: string;
  /** The file's text (`current`, empty when there is none) with the setting in. */
  merge(current: string): ConfigLinesAnswer;
}

/**
 * Config files of one kind in a folder, as many as the person keeps, each layered over the host's main config, such
 * as Codex CLI's `<name>.config.toml` profiles: `setup hooks` edits each existing one the setting needs, and creates
 * none.
 */
export interface HostConfigFileSet {
  /** The folder the files are in, for the person whose home folder is `userHome`. */
  folder(userHome: string): string;
  /** Whether a file in the folder, by its name, is one of the set. */
  holds(name: string): boolean;
  /**
   * The end every file of the set has, such as `.config.toml`: the install guard keeps each name in the folder that
   * ends so (T5542), as it cannot ask `holds` of a glob.
   */
  readonly suffix: string;
  /** The setting as the person reads it in each file, such as `[features] unified_exec_tty = false where set`. */
  readonly setting: string;
  /** One file's text with the setting in, or undefined when it already reads so. */
  merge(current: string): ConfigLinesAnswer;
}

/**
 * The kit launcher a host's hook line may run in place of a plugin folder (T5278 design D): `<kit home>/bin/teamrig.mjs`,
 * which checks the current kit version before it runs a line of it. A line naming it holds no version, so the host's
 * trust in it outlives every update. The core gives its path and the words it reads; an adapter only writes them.
 */
export interface HookLauncher {
  /** The launcher's absolute path. */
  readonly path: string;
  /** The flag naming the entry script, read and taken off by the launcher before the CLI's words. */
  readonly entryFlag: string;
  /** The flag naming the host event, which sets the exit a failed check ends with. */
  readonly eventFlag: string;
  /** The launcher's word for each entry script, by the script's path below the plugin root (`dist/cli/main.js`). */
  readonly entries: ReadonlyMap<string, string>;
}

/** A host's lines that run the kit launcher: what `kit uninstall` does to them before the launcher goes. */
export interface KitLauncherLines {
  /**
   * The person's hooks file (`current`) with every one of teamrig's handlers taken out, whether its line runs
   * `launcher` or names a plugin folder, the person's own kept as they are; the plan's file is undefined when it
   * holds none, and its counts give each one taken out as removed.
   */
  remove(current: JsonRecord, launcher: HookLauncher): UserHooksAnswer;
}

/**
 * The person's own hooks file of a host that loads no plugin's hooks: teamrig's handlers go in beside the person's
 * own, which stay as they are. The core reads and writes the file and keeps the old one; this port only says where
 * the file is and how its content changes.
 */
export interface HostUserHooks {
  /** The name a person picks this host by, as `setup hooks --host` takes it. */
  readonly host: string;
  /** The hooks file the host reads for the person whose home folder is `userHome`, in every project. */
  file(userHome: string): string;
  /**
   * Merges teamrig's hooks file (`source`, as the plugin ships it, parsed) into the person's (`current`, empty when
   * there is none), with the plugin installed at `pluginRoot`: teamrig's earlier handlers are replaced, the person's
   * kept. A host whose lines run the kit launcher (`kitLauncher`) writes `launcher` in place of the plugin folder,
   * and refuses when it is not given; a host that runs from the plugin folder leaves it unread.
   */
  merge(current: JsonRecord, source: unknown, pluginRoot: string, launcher?: HookLauncher): UserHooksAnswer;
  /**
   * Set when the host's lines run the kit launcher, so `setup hooks` refuses until the kit home can run them and
   * `kit uninstall` takes them out before it removes the launcher; left out for a host whose lines name the plugin
   * folder, so an adapter written before this field stays as it was.
   */
  readonly kitLauncher?: KitLauncherLines;
  /** What the person must do after a write before the host runs the new handlers, one line each. */
  readonly afterWrite: readonly string[];
  /** The settings the hooks need in the host's config files, written with them; empty when they need none. */
  readonly configLines: readonly HostConfigLines[];
  /**
   * The sets of config files the hooks need the setting in as well, such as named profiles a host layers over its
   * main config; none when left out, so an adapter written before this field stays as it was.
   */
  readonly configFileSets?: readonly HostConfigFileSet[];
}

/** A handler from teamrig's hooks file that a host cannot run. */
export interface SkippedUserHook {
  readonly event: string;
  readonly matcher?: string;
  readonly words: readonly string[];
  readonly reason: string;
}

/** Counts inserted, unchanged, changed, and removed handlers between two keyed maps of JSON-encoded handlers. */
export function userHooksCounts(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): UserHooksCounts {
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

/** Formats a skipped handler for `setup hooks` output. */
export function skippedUserHookLine(skipped: SkippedUserHook): string {
  const where = skipped.matcher === undefined ? skipped.event : `${skipped.event} (${skipped.matcher})`;
  return `${where}: ${skipped.words.join(' ')}: ${skipped.reason}`;
}
