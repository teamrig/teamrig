/**
 * The hook events teamrig's hooks and Codex CLI share.
 *
 * Codex CLI 0.170.0 fires 14 hook events (`codex-rs/protocol/src/hooks.rs`, tag rust-v0.170.0) and teamrig's hooks
 * file names 15. These 11 are in both. Codex has no PostToolUseFailure, Elicitation, ElicitationResult or StopFailure,
 * and teamrig hooks nothing to Codex's PreModelRequest, PostModelRequest or Interrupt.
 */
export const SHARED_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentStop',
  'Stop',
] as const;

export type SharedHookEvent = (typeof SHARED_HOOK_EVENTS)[number];

export function isSharedHookEvent(name: string): name is SharedHookEvent {
  return SHARED_HOOK_EVENTS.some((event) => event === name);
}
