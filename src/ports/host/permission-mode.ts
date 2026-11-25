import type { HookEvent } from './hook-bridge.ts';
import { knownFrom, type Known } from './known.ts';

/**
 * How freely a host lets a session act, under teamrig's own names, so guards and the pane read one list across
 * hosts. `unmapped` is a word the host's adapter does not map: kept as it is, never guessed into a nearer mode.
 */
export const PERMISSION_MODES = ['ask', 'accept-edits', 'plan', 'no-prompts', 'auto', 'bypass', 'unmapped'] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** A mode an adapter may map a host's word to: any but `unmapped`, which is what no mapping means. */
export type MappedPermissionMode = Exclude<PermissionMode, 'unmapped'>;

/**
 * The permission mode a host reported, with the host's own word beside it. The word is host input: a reader prints
 * it only escaped and capped, and a public report leaves it out.
 */
export interface ObservedPermission {
  readonly mode: PermissionMode;
  readonly hostWord: string;
}

/**
 * The mode `hostWord` maps to in an adapter's `table`, matched exactly and case-sensitively: a prefix, a substring or
 * another case of a word is `unmapped`, so a host's new word is never read as one it resembles.
 */
export function observedPermission(hostWord: string, table: Readonly<Record<string, MappedPermissionMode>>): ObservedPermission {
  return { mode: Object.hasOwn(table, hostWord) ? (table[hostWord] ?? 'unmapped') : 'unmapped', hostWord };
}

/**
 * What a session runs on as its host reported it, not as teamrig launched it: a host may override a launch flag
 * through a profile or a managed setting, so the launch arguments never stand in for any field here.
 */
export interface EffectiveConfig {
  readonly model: Known<string>;
  readonly effort: Known<string>;
  readonly permissionMode: Known<ObservedPermission>;
}

/**
 * The effective config one hook call reports: each field as the hook input told it, unknown where it told none. A hook
 * input is the host's report of the moment it fires at, so a field it carries is what took effect.
 */
export function effectiveOf(event: Pick<HookEvent, 'model' | 'effort' | 'permission'>): EffectiveConfig {
  return {
    model: knownFrom(event.model, 'hook-input'),
    effort: knownFrom(event.effort, 'hook-input'),
    permissionMode: knownFrom(event.permission, 'hook-input'),
  };
}
