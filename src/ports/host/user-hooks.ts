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
   * kept.
   */
  merge(current: JsonRecord, source: unknown, pluginRoot: string): UserHooksAnswer;
  /** What the person must do after a write before the host runs the new handlers, one line each. */
  readonly afterWrite: readonly string[];
  /** The settings the hooks need in the host's config files, written with them; empty when they need none. */
  readonly configLines: readonly HostConfigLines[];
}
