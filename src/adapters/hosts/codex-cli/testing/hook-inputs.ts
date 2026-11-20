/**
 * Hook inputs for the Codex CLI adapter's specs, built from the source, not recorded from a run.
 *
 * Each one is written by hand from Codex 0.170.0's JSON schema for its event and holds every field that schema
 * names. No Codex produced them: the ids, paths and texts are made up, and where the schema leaves a value open
 * (`tool_input`, `tool_response`) only the shapes read from Codex's source are used (a shell call and an
 * `apply_patch` call both carry `{ command }`). A `tool_response` has no shape in the schema, so a plain text stands
 * in for it. Inputs recorded from a live Codex replace these once a host has one; until then a spec that passes on
 * them shows the code agrees with the schema, not with a running Codex.
 */

import type { SharedHookEvent } from '../events.ts';

export interface SourceBuiltHookInput {
  readonly event: SharedHookEvent;
  readonly input: Readonly<Record<string, unknown>>;
}

const SESSION = {
  session_id: '0198c1d2-7a41-7c30-9f5e-3b6a2d4e8f10',
  cwd: '/work/project',
  transcript_path: '/work/codex-home/sessions/2026/11/20/rollout-0198c1d2.jsonl',
} as const;

const TURN = { ...SESSION, model: 'gpt-5.2-codex', turn_id: '0198c1d2-9b10-7e42-8a61-5c7d9e0f1a23' } as const;

const PERMITTED_TURN = { ...TURN, permission_mode: 'default' } as const;

const HELPER = { agent_id: '0198c1d3-11aa-7b52-a6c4-2d3e4f5a6b7c', agent_type: 'explorer' } as const;

const SHELL_CALL = { tool_name: 'Bash', tool_input: { command: 'git status --short' } } as const;

/** A patch that adds one file and changes one line of another. */
export const SOURCE_BUILT_PATCH = [
  '*** Begin Patch',
  '*** Add File: notes/todo.md',
  '+- write the spec',
  '*** Update File: src/app.ts',
  '@@',
  "-const greeting = 'hello';",
  "+const greeting = 'hello, team';",
  '*** End Patch',
].join('\n');

export const SOURCE_BUILT_HOOK_INPUTS = {
  sessionStart: {
    event: 'SessionStart',
    input: { ...SESSION, hook_event_name: 'SessionStart', model: TURN.model, permission_mode: 'default', source: 'startup' },
  },
  sessionStartWithNoTranscript: {
    event: 'SessionStart',
    input: {
      ...SESSION,
      hook_event_name: 'SessionStart',
      transcript_path: null,
      model: TURN.model,
      permission_mode: 'default',
      source: 'clear',
    },
  },
  sessionEnd: { event: 'SessionEnd', input: { ...SESSION, hook_event_name: 'SessionEnd', reason: 'other' } },
  userPromptSubmit: {
    event: 'UserPromptSubmit',
    input: { ...PERMITTED_TURN, hook_event_name: 'UserPromptSubmit', prompt: 'What is next on my list?' },
  },
  preToolUseShell: {
    event: 'PreToolUse',
    input: { ...PERMITTED_TURN, hook_event_name: 'PreToolUse', ...SHELL_CALL, tool_use_id: 'call_shell_1' },
  },
  preToolUseApplyPatch: {
    event: 'PreToolUse',
    input: {
      ...PERMITTED_TURN,
      hook_event_name: 'PreToolUse',
      tool_name: 'apply_patch',
      tool_input: { command: SOURCE_BUILT_PATCH },
      tool_use_id: 'call_patch_1',
    },
  },
  preToolUseShellInHelper: {
    event: 'PreToolUse',
    input: { ...PERMITTED_TURN, ...HELPER, hook_event_name: 'PreToolUse', ...SHELL_CALL, tool_use_id: 'call_shell_2' },
  },
  permissionRequest: {
    event: 'PermissionRequest',
    input: { ...PERMITTED_TURN, hook_event_name: 'PermissionRequest', ...SHELL_CALL },
  },
  postToolUseShell: {
    event: 'PostToolUse',
    input: {
      ...PERMITTED_TURN,
      hook_event_name: 'PostToolUse',
      ...SHELL_CALL,
      tool_use_id: 'call_shell_1',
      tool_response: ' M src/app.ts\n',
    },
  },
  preCompact: { event: 'PreCompact', input: { ...TURN, hook_event_name: 'PreCompact', trigger: 'auto' } },
  postCompact: { event: 'PostCompact', input: { ...TURN, hook_event_name: 'PostCompact', trigger: 'manual' } },
  subagentStart: {
    event: 'SubagentStart',
    input: { ...PERMITTED_TURN, ...HELPER, hook_event_name: 'SubagentStart' },
  },
  subagentStop: {
    event: 'SubagentStop',
    input: {
      ...PERMITTED_TURN,
      ...HELPER,
      hook_event_name: 'SubagentStop',
      agent_transcript_path: '/work/codex-home/sessions/2026/11/20/rollout-0198c1d3.jsonl',
      last_assistant_message: 'Two files read; nothing to change.',
      stop_hook_active: false,
    },
  },
  stop: {
    event: 'Stop',
    input: { ...PERMITTED_TURN, hook_event_name: 'Stop', last_assistant_message: null, stop_hook_active: false },
  },
} as const satisfies Readonly<Record<string, SourceBuiltHookInput>>;
