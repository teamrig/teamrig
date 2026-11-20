import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SHARED_HOOK_EVENTS, type SharedHookEvent } from './events.ts';
import { codexReply } from './reply.ts';

type Rec = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/*
 * How Codex CLI 0.170.0 reads a command hook's stdout, written out by hand from its source
 * (`codex-rs/hooks/src/engine/output_parser.rs` and the output schemas beside it, tag rust-v0.170.0) so the specs can
 * ask what Codex would do with a rewritten reply. No Codex runs here: a spec that passes shows the rewrite agrees
 * with that source, not with a running Codex. It is stricter than Codex in one way: a `null` is refused everywhere.
 */

type Kind = 'boolean' | 'string' | 'any value' | readonly string[] | Shape;

interface Shape {
  readonly required: Readonly<Record<string, Kind>>;
  readonly optional: Readonly<Record<string, Kind>>;
}

interface CodexReading {
  /** False when Codex has no reply at all: nothing printed, or a text its schema refuses. */
  readonly taken: boolean;
  /** Why Codex throws the reply's verdict away and goes on as if no hook ran, when it does. */
  readonly invalid: string | undefined;
  /** The reason Codex blocks the call, the prompt or the stop with. */
  readonly refused: string | undefined;
  /** A permission request approved with no prompt. */
  readonly allowed: boolean;
  /** The input Codex runs the call with instead of the model's. */
  readonly rewrite: unknown;
  readonly stopped: boolean;
  readonly context: string | undefined;
}

type Verdict = Partial<Pick<CodexReading, 'invalid' | 'refused' | 'allowed' | 'rewrite'>>;

const UNIVERSAL = { continue: 'boolean', stopReason: 'string', suppressOutput: 'boolean', systemMessage: 'string' } as const;
const BLOCK = { decision: ['block'], reason: 'string' } as const;
const CONTEXT = { additionalContext: 'string' } as const;
const APPROVAL: Shape = {
  required: { behavior: ['allow', 'deny'] },
  optional: { interrupt: 'boolean', message: 'string', updatedInput: 'any value', updatedPermissions: 'any value' },
};
const PRE_TOOL_VERDICT = {
  permissionDecision: ['allow', 'deny', 'ask'],
  permissionDecisionReason: 'string',
  updatedInput: 'any value',
} as const;

function output(fields: Readonly<Record<string, Kind>>): Shape {
  return { required: {}, optional: { ...UNIVERSAL, ...fields } };
}

function specific(event: SharedHookEvent, fields: Readonly<Record<string, Kind>>): Shape {
  return { required: { hookEventName: [event] }, optional: fields };
}

/** SessionEnd has no output schema: Codex never reads that hook's stdout. */
const OUTPUTS: Readonly<Partial<Record<SharedHookEvent, Shape>>> = {
  SessionStart: output({ hookSpecificOutput: specific('SessionStart', CONTEXT) }),
  SubagentStart: output({ hookSpecificOutput: specific('SubagentStart', CONTEXT) }),
  UserPromptSubmit: output({ ...BLOCK, hookSpecificOutput: specific('UserPromptSubmit', CONTEXT) }),
  PreToolUse: output({
    decision: ['approve', 'block'],
    reason: 'string',
    hookSpecificOutput: specific('PreToolUse', { ...CONTEXT, ...PRE_TOOL_VERDICT }),
  }),
  PermissionRequest: output({ hookSpecificOutput: specific('PermissionRequest', { decision: APPROVAL }) }),
  PostToolUse: output({ ...BLOCK, hookSpecificOutput: specific('PostToolUse', { ...CONTEXT, updatedMCPToolOutput: 'any value' }) }),
  PreCompact: output({}),
  PostCompact: output({}),
  SubagentStop: output(BLOCK),
  Stop: output(BLOCK),
};

function fits(value: unknown, kind: Kind): boolean {
  if (kind === 'any value') {
    return value !== undefined && value !== null;
  }
  if (kind === 'boolean' || kind === 'string') {
    return typeof value === kind;
  }
  if (!('required' in kind)) {
    return typeof value === 'string' && kind.includes(value);
  }
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => Object.hasOwn(kind.required, key) || Object.hasOwn(kind.optional, key)) &&
    Object.entries(kind.required).every(([key, inner]) => fits(value[key], inner)) &&
    Object.entries(kind.optional).every(([key, inner]) => !Object.hasOwn(value, key) || fits(value[key], inner))
  );
}

function partIn(record: Rec | undefined, key: string): Rec | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function textIn(record: Rec | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

/** A reason as Codex uses one: trimmed, and no reason at all when blank. */
function reasonIn(record: Rec | undefined, key: string): string | undefined {
  const reason = textIn(record, key)?.trim();
  return reason === undefined || reason === '' ? undefined : reason;
}

function toolCallInvalid(event: string, out: Rec): string | undefined {
  if (out['continue'] === false) {
    return `${event} hook returned unsupported continue:false`;
  }
  if (out['stopReason'] !== undefined) {
    return `${event} hook returned unsupported stopReason`;
  }
  return out['suppressOutput'] === true ? `${event} hook returned unsupported suppressOutput` : undefined;
}

function preToolSpecificInvalid(verdict: unknown, part: Rec): string | undefined {
  if (part['updatedInput'] !== undefined && verdict !== 'allow') {
    return 'PreToolUse hook returned updatedInput without permissionDecision:allow';
  }
  switch (verdict) {
    case 'allow':
      return part['updatedInput'] === undefined ? 'PreToolUse hook returned unsupported permissionDecision:allow' : undefined;
    case 'ask':
      return 'PreToolUse hook returned unsupported permissionDecision:ask';
    case 'deny':
      return reasonIn(part, 'permissionDecisionReason') === undefined ? 'PreToolUse hook returned permissionDecision:deny without a reason' : undefined;
    default:
      return part['permissionDecisionReason'] === undefined ? undefined : 'PreToolUse hook returned permissionDecisionReason without permissionDecision';
  }
}

function preToolLegacyInvalid(out: Rec): string | undefined {
  switch (out['decision']) {
    case 'approve':
      return 'PreToolUse hook returned unsupported decision:approve';
    case 'block':
      return reasonIn(out, 'reason') === undefined ? 'PreToolUse hook returned decision:block without a non-empty reason' : undefined;
    default:
      return out['reason'] === undefined ? undefined : 'PreToolUse hook returned reason without decision';
  }
}

function preToolUseReads(out: Rec, part: Rec | undefined): Verdict {
  const verdict = part?.['permissionDecision'];
  const usesSpecific =
    part !== undefined && (verdict !== undefined || part['permissionDecisionReason'] !== undefined || part['updatedInput'] !== undefined);
  const invalid = toolCallInvalid('PreToolUse', out) ?? (usesSpecific ? preToolSpecificInvalid(verdict, part) : preToolLegacyInvalid(out));
  if (invalid !== undefined) {
    return { invalid };
  }
  if (!usesSpecific) {
    return { refused: out['decision'] === 'block' ? reasonIn(out, 'reason') : undefined };
  }
  return verdict === 'deny' ? { refused: reasonIn(part, 'permissionDecisionReason') } : { rewrite: part['updatedInput'] };
}

function permissionRequestReads(out: Rec, part: Rec | undefined): Verdict {
  const decision = partIn(part, 'decision');
  const universal = toolCallInvalid('PermissionRequest', out);
  if (universal !== undefined) {
    return { invalid: universal };
  }
  if (decision === undefined) {
    return {};
  }
  if (decision['updatedInput'] !== undefined || decision['updatedPermissions'] !== undefined || decision['interrupt'] === true) {
    return { invalid: 'PermissionRequest hook returned an unsupported updatedInput, updatedPermissions or interrupt:true' };
  }
  return decision['behavior'] === 'allow' ? { allowed: true } : { refused: reasonIn(decision, 'message') ?? 'PermissionRequest hook denied approval' };
}

function blockReads(event: string, out: Rec): Verdict {
  if (out['decision'] !== 'block') {
    return {};
  }
  const reason = reasonIn(out, 'reason');
  return reason === undefined ? { invalid: `${event} hook returned decision:block without a non-empty reason` } : { refused: reason };
}

function postToolUseReads(out: Rec, part: Rec | undefined): Verdict {
  if (out['suppressOutput'] === true) {
    return { invalid: 'PostToolUse hook returned unsupported suppressOutput' };
  }
  if (part?.['updatedMCPToolOutput'] !== undefined) {
    return { invalid: 'PostToolUse hook returned unsupported updatedMCPToolOutput' };
  }
  if (out['decision'] !== 'block' && out['continue'] !== false && out['reason'] !== undefined) {
    return { invalid: 'PostToolUse hook returned reason without decision' };
  }
  return blockReads('PostToolUse', out);
}

const VERDICTS: Readonly<Partial<Record<SharedHookEvent, (out: Rec, part: Rec | undefined) => Verdict>>> = {
  PreToolUse: preToolUseReads,
  PermissionRequest: permissionRequestReads,
  PostToolUse: postToolUseReads,
  UserPromptSubmit: (out) => blockReads('UserPromptSubmit', out),
  SubagentStop: (out) => blockReads('SubagentStop', out),
  Stop: (out) => blockReads('Stop', out),
};

const NO_REPLY: CodexReading = {
  taken: false,
  invalid: undefined,
  refused: undefined,
  allowed: false,
  rewrite: undefined,
  stopped: false,
  context: undefined,
};

function codexReads(event: SharedHookEvent, stdout: string): CodexReading {
  const shape = OUTPUTS[event];
  if (shape === undefined || stdout.trim() === '') {
    return NO_REPLY;
  }
  let out: unknown;
  try {
    out = JSON.parse(stdout.trim());
  } catch {
    return NO_REPLY;
  }
  if (!isRecord(out) || !fits(out, shape)) {
    return NO_REPLY;
  }
  const part = partIn(out, 'hookSpecificOutput');
  const verdict = VERDICTS[event]?.(out, part) ?? {};
  return { ...NO_REPLY, taken: true, stopped: out['continue'] === false, context: textIn(part, 'additionalContext'), ...verdict };
}

/* The specs. */

interface Rewrite {
  readonly stdout: string;
  /** The reply Codex is handed, parsed; `undefined` when nothing is printed. */
  readonly sent: unknown;
  readonly dropped: readonly string[];
  readonly codex: CodexReading;
}

function rewriteOfText(event: SharedHookEvent, text: string): Rewrite {
  const { stdout, dropped } = codexReply(event, text);
  const sent: unknown = stdout === '' ? undefined : JSON.parse(stdout);
  return { stdout, sent, dropped, codex: codexReads(event, stdout) };
}

function rewriteOf(event: SharedHookEvent, reply: unknown): Rewrite {
  return rewriteOfText(event, JSON.stringify(reply));
}

/** A PreToolUse reply holding only a `hookSpecificOutput` with these fields. */
function preTool(fields: Rec): Rec {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', ...fields } };
}

/** A PermissionRequest reply holding only a decision with these fields. */
function approval(fields: Rec): Rec {
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: fields } };
}

const BLOCKING_EVENTS: readonly SharedHookEvent[] = ['UserPromptSubmit', 'PostToolUse', 'SubagentStop', 'Stop'];
const CONTEXT_EVENTS: readonly SharedHookEvent[] = ['SessionStart', 'SubagentStart', 'UserPromptSubmit'];
const CODEX_OWN_DENY_TEXT = 'PermissionRequest hook denied approval';

interface OwnReply {
  readonly name: string;
  readonly event: SharedHookEvent;
  readonly reply: Rec;
  /** What Codex is handed; `undefined` for nothing. */
  readonly sent: unknown;
  readonly dropped: readonly string[];
}

/** The shapes teamrig's hooks print today, each named by the function that prints it. */
const OWN_REPLIES: readonly OwnReply[] = [
  {
    name: 'a refused call (refusalOutput)',
    event: 'PreToolUse',
    reply: preTool({ permissionDecision: 'deny', permissionDecisionReason: 'Pushing to main is refused.' }),
    sent: preTool({ permissionDecision: 'deny', permissionDecisionReason: 'Pushing to main is refused.' }),
    dropped: [],
  },
  {
    name: 'a read-only line allowed with no rewrite (readonly-shell)',
    event: 'PreToolUse',
    reply: preTool({ permissionDecision: 'allow', permissionDecisionReason: 'A read-only line.' }),
    sent: undefined,
    dropped: ['hookSpecificOutput.permissionDecision', 'hookSpecificOutput.permissionDecisionReason'],
  },
  {
    name: 'a note for the user alone (push-guard)',
    event: 'PreToolUse',
    reply: { systemMessage: 'This push is cleared.' },
    sent: { systemMessage: 'This push is cleared.' },
    dropped: [],
  },
  {
    name: 'a refusal with a reminder for the model (helperGateOutput)',
    event: 'PreToolUse',
    reply: preTool({ permissionDecision: 'deny', permissionDecisionReason: 'Past the budget.', additionalContext: 'A helper costs more.' }),
    sent: preTool({ permissionDecision: 'deny', permissionDecisionReason: 'Past the budget.', additionalContext: 'A helper costs more.' }),
    dropped: [],
  },
  {
    name: 'a reminder for the model with no verdict (helperGateOutput)',
    event: 'PreToolUse',
    reply: preTool({ additionalContext: 'A helper costs more.' }),
    sent: preTool({ additionalContext: 'A helper costs more.' }),
    dropped: [],
  },
  {
    name: 'a refused prompt (promptRefuseOutput)',
    event: 'PermissionRequest',
    reply: approval({ behavior: 'deny', message: 'Run it as one line.' }),
    sent: approval({ behavior: 'deny', message: 'Run it as one line.' }),
    dropped: [],
  },
  {
    name: 'an answered prompt (promptAnswerOutput)',
    event: 'PermissionRequest',
    reply: approval({ behavior: 'allow' }),
    sent: approval({ behavior: 'allow' }),
    dropped: [],
  },
  {
    name: 'a stopped prompt (promptBlockOutput)',
    event: 'UserPromptSubmit',
    reply: { decision: 'block', reason: 'The prompt holds a key.', hookSpecificOutput: { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true } },
    sent: { decision: 'block', reason: 'The prompt holds a key.' },
    dropped: ['hookSpecificOutput.suppressOriginalPrompt'],
  },
  {
    name: 'prompt context with a session title (promptOutput)',
    event: 'UserPromptSubmit',
    reply: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'INBOX: one line', sessionTitle: 'tr-codex-host' } },
    sent: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'INBOX: one line' } },
    dropped: ['hookSpecificOutput.sessionTitle'],
  },
  {
    name: 'a session title alone (promptOutput)',
    event: 'UserPromptSubmit',
    reply: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', sessionTitle: 'tr-codex-host' } },
    sent: undefined,
    dropped: ['hookSpecificOutput.sessionTitle'],
  },
  {
    name: "context after a tool's result (postToolUseContext)",
    event: 'PostToolUse',
    reply: { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'The file changed.' } },
    sent: { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'The file changed.' } },
    dropped: [],
  },
  {
    name: "a replaced tool result (postToolUseReplace)",
    event: 'PostToolUse',
    reply: { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: { stdout: '[redacted]' }, additionalContext: 'A key was cut out.' } },
    sent: { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'A key was cut out.' } },
    dropped: ['hookSpecificOutput.updatedToolOutput'],
  },
  {
    name: 'a session kept going with notices (blockOutput)',
    event: 'Stop',
    reply: { decision: 'block', reason: 'Read your inbox.', systemMessage: 'One new line.' },
    sent: { systemMessage: 'One new line.', decision: 'block', reason: 'Read your inbox.' },
    dropped: [],
  },
  {
    name: 'a tab title (titleOf)',
    event: 'Stop',
    reply: { terminalSequence: '\u001b]0;tr-codex-host\u0007' },
    sent: undefined,
    dropped: ['terminalSequence'],
  },
  {
    name: 'start context with notices (sessionStartOutput)',
    event: 'SessionStart',
    reply: { systemMessage: 'A newer version is out.', hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Team rules' } },
    sent: { systemMessage: 'A newer version is out.', hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Team rules' } },
    dropped: [],
  },
  {
    name: "a helper's start context (helper-start)",
    event: 'SubagentStart',
    reply: { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: 'Helper rules' } },
    sent: { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: 'Helper rules' } },
    dropped: [],
  },
  {
    name: 'a compaction held back (hook-refresh-mod)',
    event: 'PreCompact',
    reply: { decision: 'block', reason: 'Refresh the session instead.' },
    sent: { continue: false, stopReason: 'Refresh the session instead.' },
    dropped: [],
  },
];

describe("the replies teamrig's hooks print, rewritten for Codex", () => {
  for (const own of OWN_REPLIES) {
    it(`${own.event}: ${own.name}`, () => {
      const { sent, dropped, codex } = rewriteOf(own.event, own.reply);
      assert.deepEqual(sent, own.sent);
      assert.deepEqual(dropped, own.dropped);
      assert.equal(codex.taken, own.sent !== undefined);
      assert.equal(codex.invalid, undefined);
    });
  }

  it('keeps a refusal a refusal, with its reason', () => {
    const refusal = rewriteOf('PreToolUse', preTool({ permissionDecision: 'deny', permissionDecisionReason: 'Pushing to main is refused.' }));
    assert.equal(refusal.codex.refused, 'Pushing to main is refused.');
    assert.equal(rewriteOf('PermissionRequest', approval({ behavior: 'deny', message: 'Run it as one line.' })).codex.refused, 'Run it as one line.');
    assert.equal(rewriteOf('PermissionRequest', approval({ behavior: 'allow' })).codex.allowed, true);
  });

  it('prints one line whatever a reason holds', () => {
    const { stdout, codex } = rewriteOf('Stop', { decision: 'block', reason: 'first line\nsecond line\r\nthird' });
    assert.equal(stdout.includes('\n'), false);
    assert.equal(stdout.includes('\r'), false);
    assert.equal(codex.refused, 'first line\nsecond line\r\nthird');
  });
});

describe('a hook that printed nothing', () => {
  for (const event of SHARED_HOOK_EVENTS) {
    it(`${event}: prints nothing for Codex and drops nothing`, () => {
      assert.deepEqual(codexReply(event, ''), { stdout: '', dropped: [] });
      assert.deepEqual(codexReply(event, ' \r\n\t'), { stdout: '', dropped: [] });
      assert.deepEqual(codexReply(event, '{}'), { stdout: '', dropped: [] });
    });
  }
});

interface Refusing {
  readonly name: string;
  readonly reply: unknown;
  /** The reason Codex refuses the call with; left out where only a refusal is asserted. */
  readonly reason?: string;
}

/** Each of these runs the call on Codex 0.170.0 when handed over as teamrig printed it. */
const PRE_TOOL_REFUSALS: readonly Refusing[] = [
  { name: 'a deny with a blank reason', reply: preTool({ permissionDecision: 'deny', permissionDecisionReason: '  ' }) },
  { name: 'a deny with no reason', reply: preTool({ permissionDecision: 'deny' }) },
  { name: 'a deny whose reason is no text', reply: preTool({ permissionDecision: 'deny', permissionDecisionReason: 7 }) },
  { name: 'an ask', reply: preTool({ permissionDecision: 'ask' }) },
  {
    name: 'an ask with its reason',
    reply: preTool({ permissionDecision: 'ask', permissionDecisionReason: 'This deletes a branch.' }),
    reason: 'This deletes a branch. (refused: a Codex hook cannot ask a person to approve a call)',
  },
  { name: 'a verdict word Codex does not know', reply: preTool({ permissionDecision: 'defer' }) },
  { name: 'a verdict that is no text', reply: preTool({ permissionDecision: true }) },
  { name: 'a verdict that is an object', reply: preTool({ permissionDecision: { behavior: 'deny' } }) },
  { name: 'a legacy block', reply: { decision: 'block', reason: 'Not this file.' }, reason: 'Not this file.' },
  { name: 'a legacy block with no reason', reply: { decision: 'block' } },
  { name: 'a legacy verdict word Codex does not know', reply: { decision: 'deny', reason: 'No.' } },
  { name: 'a legacy verdict that is no text', reply: { decision: false } },
  { name: 'a stop', reply: { continue: false, stopReason: 'The budget is spent.' }, reason: 'The budget is spent.' },
  { name: 'a stop with no reason', reply: { continue: false } },
  { name: 'a stop beside an allow', reply: { continue: false, ...preTool({ permissionDecision: 'allow', updatedInput: { command: 'ls' } }) } },
  { name: 'a continue that is not true or false', reply: { continue: 0 } },
  { name: 'a hookSpecificOutput that is a text', reply: { hookSpecificOutput: 'deny' } },
  { name: 'a hookSpecificOutput that is a list', reply: { hookSpecificOutput: [{ permissionDecision: 'deny' }] } },
  { name: 'a rewritten input with no verdict', reply: preTool({ updatedInput: { command: 'ls' } }) },
  { name: 'a rewritten input beside a legacy approve', reply: { decision: 'approve', ...preTool({ updatedInput: { command: 'ls' } }) } },
  {
    name: 'an allow beside a legacy block',
    reply: { decision: 'block', reason: 'Not this file.', ...preTool({ permissionDecision: 'allow', updatedInput: { command: 'ls' } }) },
    reason: 'Not this file.',
  },
  {
    name: 'a deny beside a legacy approve',
    reply: { decision: 'approve', ...preTool({ permissionDecision: 'deny', permissionDecisionReason: 'Not this file.' }) },
    reason: 'Not this file.',
  },
  {
    name: 'a deny beside keys Codex has no hook for at a tool call',
    reply: { suppressOutput: true, stopReason: 'done', ...preTool({ permissionDecision: 'deny', permissionDecisionReason: 'Not this file.' }) },
    reason: 'Not this file.',
  },
  {
    name: 'a deny beside a key Codex does not know',
    reply: { terminalSequence: 'x', ...preTool({ permissionDecision: 'deny', permissionDecisionReason: 'Not this file.', sessionTitle: 't' }) },
    reason: 'Not this file.',
  },
  {
    name: 'a deny beside a value of the wrong type',
    reply: { systemMessage: 123, ...preTool({ permissionDecision: 'deny', permissionDecisionReason: 'Not this file.', additionalContext: 5 }) },
    reason: 'Not this file.',
  },
];

describe('a PreToolUse reply that refuses the call', () => {
  for (const refusing of PRE_TOOL_REFUSALS) {
    it(`refuses the call on Codex for ${refusing.name}`, () => {
      const { sent, codex } = rewriteOf('PreToolUse', refusing.reply);
      assert.equal(codex.taken, true);
      assert.equal(codex.invalid, undefined);
      assert.equal(typeof codex.refused, 'string');
      if (refusing.reason !== undefined) {
        assert.equal(codex.refused, refusing.reason);
      }
      // Always the hook-specific form, never the legacy keys.
      assert.equal(isRecord(sent) && !Object.hasOwn(sent, 'decision') && !Object.hasOwn(sent, 'reason'), true);
    });
  }

  it('says why an ask is refused, and that a hook gave no reason', () => {
    assert.match(rewriteOf('PreToolUse', preTool({ permissionDecision: 'ask' })).codex.refused ?? '', /a Codex hook cannot ask for/u);
    assert.match(rewriteOf('PreToolUse', preTool({ permissionDecision: 'deny' })).codex.refused ?? '', /gave no reason/u);
    assert.match(rewriteOf('PreToolUse', { continue: false }).codex.refused ?? '', /stopped the session/u);
    assert.match(rewriteOf('PreToolUse', preTool({ permissionDecision: 'defer' })).codex.refused ?? '', /not one Codex knows/u);
    assert.match(rewriteOf('PreToolUse', preTool({ updatedInput: {} })).codex.refused ?? '', /rewrote this call without allowing it/u);
    assert.match(rewriteOf('PreToolUse', { hookSpecificOutput: 'deny' }).codex.refused ?? '', /could not be read/u);
  });

  it('refuses the call for a verdict cut short', () => {
    for (const text of ['{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"de', '[{"decision":"block"}]', ' [']) {
      const { dropped, codex } = rewriteOfText('PreToolUse', text);
      assert.match(codex.refused ?? '', /could not be read/u);
      assert.deepEqual(dropped, []);
    }
  });

  it('drops nothing of a verdict it turned into a refusal', () => {
    const reply = { continue: false, stopReason: 'Spent.', decision: 'approve', reason: 'fine', ...preTool({ permissionDecision: 'allow', updatedInput: {} }) };
    assert.deepEqual(rewriteOf('PreToolUse', reply).dropped, []);
    assert.deepEqual(rewriteOf('PreToolUse', { hookSpecificOutput: 'deny' }).dropped, []);
  });

  it('hands the model the context beside a refusal', () => {
    const reply = preTool({ permissionDecision: 'ask', permissionDecisionReason: 'Over the budget.', additionalContext: 'A helper costs more.' });
    assert.equal(rewriteOf('PreToolUse', reply).codex.context, 'A helper costs more.');
  });
});

describe('a PreToolUse reply that does not refuse the call', () => {
  it('hands on an allow that rewrites the input, with its reason', () => {
    const reply = preTool({ permissionDecision: 'allow', permissionDecisionReason: ' Quoted the path. ', updatedInput: { command: 'ls "a b"' } });
    const { sent, dropped, codex } = rewriteOf('PreToolUse', reply);
    assert.deepEqual(sent, preTool({ permissionDecision: 'allow', permissionDecisionReason: 'Quoted the path.', updatedInput: { command: 'ls "a b"' } }));
    assert.deepEqual(dropped, []);
    assert.equal(codex.invalid, undefined);
    assert.deepEqual(codex.rewrite, { command: 'ls "a b"' });
  });

  it('leaves an allow with no rewrite to Codex and reports it', () => {
    const { stdout, dropped } = rewriteOf('PreToolUse', preTool({ permissionDecision: 'allow', updatedInput: null }));
    assert.equal(stdout, '');
    assert.deepEqual(dropped, ['hookSpecificOutput.permissionDecision']);
  });

  it('keeps the context beside an allow it leaves to Codex', () => {
    const { sent, codex } = rewriteOf('PreToolUse', preTool({ permissionDecision: 'allow', additionalContext: 'A helper costs more.' }));
    assert.deepEqual(sent, preTool({ additionalContext: 'A helper costs more.' }));
    assert.equal(codex.invalid, undefined);
    assert.equal(codex.context, 'A helper costs more.');
  });

  const unused: readonly (readonly [string, Rec, readonly string[]])[] = [
    ['a legacy approve', { decision: 'approve', reason: 'fine' }, ['decision', 'reason']],
    ['a reason with no decision', { reason: 'fine' }, ['reason']],
    ['a stopReason with no stop', { continue: true, stopReason: 'later' }, ['stopReason']],
    ['a verdict reason with no verdict', preTool({ permissionDecisionReason: 'fine' }), ['hookSpecificOutput.permissionDecisionReason']],
    ['a suppressOutput', { suppressOutput: true }, ['suppressOutput']],
    ['a context that is no text', preTool({ additionalContext: ['a'] }), ['hookSpecificOutput.additionalContext']],
    ['a note that is no text', { systemMessage: { text: 'a' } }, ['systemMessage']],
    ['keys Codex does not know', { terminalSequence: 'x', ...preTool({ sessionTitle: 't' }) }, ['terminalSequence', 'hookSpecificOutput.sessionTitle']],
  ];
  for (const [name, reply, dropped] of unused) {
    it(`prints nothing for ${name} and reports it`, () => {
      assert.deepEqual(codexReply('PreToolUse', JSON.stringify(reply)), { stdout: '', dropped });
    });
  }

  it('reports neither a default nor a null', () => {
    const reply = { continue: true, suppressOutput: false, stopReason: null, decision: null, ...preTool({ permissionDecision: null, updatedInput: null }) };
    assert.deepEqual(codexReply('PreToolUse', JSON.stringify(reply)), { stdout: '', dropped: [] });
  });

  it('drops a plain text, which Codex has no use for at a tool call', () => {
    for (const text of ['all clear', '"deny"', '42', 'null']) {
      assert.deepEqual(codexReply('PreToolUse', text), { stdout: '', dropped: ['(plain text)'] });
      assert.deepEqual(codexReply('PermissionRequest', text), { stdout: '', dropped: ['(plain text)'] });
    }
  });
});

describe('a PermissionRequest reply', () => {
  const denials: readonly Refusing[] = [
    { name: 'a deny with a blank message', reply: approval({ behavior: 'deny', message: ' ' }), reason: CODEX_OWN_DENY_TEXT },
    { name: 'a deny whose message is no text', reply: approval({ behavior: 'deny', message: 5 }), reason: CODEX_OWN_DENY_TEXT },
    { name: 'a deny that rewrites the input', reply: approval({ behavior: 'deny', message: 'No.', updatedInput: {} }), reason: 'No.' },
    { name: 'a stop', reply: { continue: false, stopReason: 'Spent.', ...approval({ behavior: 'allow' }) }, reason: 'Spent.' },
    { name: 'a stop with no reason', reply: { continue: false } },
    { name: 'a continue that is not true or false', reply: { continue: 'no', ...approval({ behavior: 'allow' }) } },
    { name: 'a hookSpecificOutput that is a text', reply: { hookSpecificOutput: 'allow' } },
    { name: 'a decision that is a text', reply: { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: 'allow' } } },
    { name: 'a behavior Codex does not know', reply: approval({ behavior: 'ask' }) },
    { name: 'a decision with no behavior', reply: approval({ message: 'hm' }) },
    { name: 'a behavior that is no text', reply: approval({ behavior: true }) },
  ];
  for (const denial of denials) {
    it(`denies the request on Codex for ${denial.name}`, () => {
      const { dropped, codex } = rewriteOf('PermissionRequest', denial.reply);
      assert.equal(codex.taken, true);
      assert.equal(codex.invalid, undefined);
      assert.equal(codex.allowed, false);
      assert.equal(typeof codex.refused, 'string');
      if (denial.reason !== undefined) {
        assert.equal(codex.refused, denial.reason);
      }
      assert.deepEqual(dropped, []);
    });
  }

  it('denies the request for a verdict cut short', () => {
    const { dropped, codex } = rewriteOfText('PermissionRequest', '{"hookSpecificOutput":{"decision":{"behavior":"de');
    assert.match(codex.refused ?? '', /could not be read/u);
    assert.deepEqual(dropped, []);
  });

  it('keeps a deny and reports the interrupt Codex has no hook for', () => {
    const { dropped, codex } = rewriteOf('PermissionRequest', approval({ behavior: 'deny', message: 'No.', interrupt: true }));
    assert.equal(codex.invalid, undefined);
    assert.equal(codex.refused, 'No.');
    assert.deepEqual(dropped, ['hookSpecificOutput.decision.interrupt']);
  });

  const leftToCodex: readonly (readonly [string, Rec, readonly string[]])[] = [
    ['an allow that rewrites the input', { behavior: 'allow', updatedInput: { command: 'ls' } }, ['behavior', 'updatedInput']],
    ['an allow that rewrites the permissions', { behavior: 'allow', updatedPermissions: [{ type: 'addRules' }] }, ['behavior', 'updatedPermissions']],
    ['an allow that interrupts', { behavior: 'allow', interrupt: true }, ['behavior', 'interrupt']],
  ];
  for (const [name, decision, keys] of leftToCodex) {
    it(`leaves ${name} to Codex's own prompt and reports it`, () => {
      const dropped = keys.map((key) => `hookSpecificOutput.decision.${key}`);
      assert.deepEqual(codexReply('PermissionRequest', JSON.stringify(approval(decision))), { stdout: '', dropped });
    });
  }

  it('hands on a plain allow, reporting the message Codex does not read', () => {
    const { sent, dropped, codex } = rewriteOf('PermissionRequest', approval({ behavior: 'allow', interrupt: false, message: 'ok', note: 1 }));
    assert.deepEqual(sent, approval({ behavior: 'allow' }));
    assert.equal(codex.allowed, true);
    assert.deepEqual(dropped, ['hookSpecificOutput.decision.message', 'hookSpecificOutput.decision.note']);
  });

  it('reports the keys this event does not take, and keeps the note for the user', () => {
    const reply = { decision: 'block', reason: 'No.', suppressOutput: true, stopReason: 'x', systemMessage: 'Heads up.' };
    const { sent, dropped, codex } = rewriteOf('PermissionRequest', reply);
    assert.deepEqual(sent, { systemMessage: 'Heads up.' });
    assert.equal(codex.invalid, undefined);
    assert.deepEqual(dropped, ['decision', 'reason', 'suppressOutput', 'stopReason']);
  });

  it('prints nothing for a hookSpecificOutput with no decision', () => {
    const reply = { hookSpecificOutput: { hookEventName: 'PermissionRequest' } };
    assert.deepEqual(codexReply('PermissionRequest', JSON.stringify(reply)), { stdout: '', dropped: [] });
  });
});

describe('a block', () => {
  for (const event of BLOCKING_EVENTS) {
    it(`${event}: is handed on with its reason`, () => {
      const { sent, dropped, codex } = rewriteOf(event, { decision: 'block', reason: ' Read your inbox. ' });
      assert.deepEqual(sent, { decision: 'block', reason: 'Read your inbox.' });
      assert.deepEqual(dropped, []);
      assert.equal(codex.refused, 'Read your inbox.');
    });

    it(`${event}: gets a reason when it has none, since Codex throws a block with no reason away`, () => {
      for (const reply of [{ decision: 'block' }, { decision: 'block', reason: ' ' }, { decision: 'block', reason: 9 }]) {
        const { dropped, codex } = rewriteOf(event, reply);
        assert.equal(codex.invalid, undefined);
        assert.match(codex.refused ?? '', /gave no reason/u);
        assert.deepEqual(dropped, []);
      }
    });

    it(`${event}: leaves another decision and a lone reason unused`, () => {
      assert.deepEqual(codexReply(event, JSON.stringify({ decision: 'approve', reason: 'fine' })), { stdout: '', dropped: ['decision', 'reason'] });
      assert.deepEqual(codexReply(event, JSON.stringify({ reason: 'fine' })), { stdout: '', dropped: ['reason'] });
      assert.deepEqual(codexReply(event, JSON.stringify({ decision: ['block'] })), { stdout: '', dropped: ['decision'] });
    });
  }

  it('Stop and SubagentStop: send no hookSpecificOutput, which Codex refuses there', () => {
    for (const event of ['Stop', 'SubagentStop'] as const) {
      const reply = { decision: 'block', reason: 'Go on.', hookSpecificOutput: { hookEventName: event, additionalContext: 'more' } };
      const { sent, dropped, codex } = rewriteOf(event, reply);
      assert.deepEqual(sent, { decision: 'block', reason: 'Go on.' });
      assert.deepEqual(dropped, ['hookSpecificOutput']);
      assert.equal(codex.taken, true);
    }
  });

  it('PostToolUse: never sends suppressOutput, which Codex reads there as a broken reply', () => {
    const { sent, dropped, codex } = rewriteOf('PostToolUse', { suppressOutput: true, decision: 'block', reason: 'Fix the lint.' });
    assert.deepEqual(sent, { decision: 'block', reason: 'Fix the lint.' });
    assert.deepEqual(dropped, ['suppressOutput']);
    assert.equal(codex.refused, 'Fix the lint.');
    assert.deepEqual(codexReply('PostToolUse', JSON.stringify({ suppressOutput: false })), { stdout: '', dropped: [] });
  });

  it('PostToolUse: reports a hookSpecificOutput that is no object', () => {
    assert.deepEqual(codexReply('PostToolUse', JSON.stringify({ hookSpecificOutput: 'more' })), { stdout: '', dropped: ['hookSpecificOutput'] });
  });

  it('PostToolUse: hands on a stop, with its reason when it has one', () => {
    assert.deepEqual(rewriteOf('PostToolUse', { continue: false, stopReason: ' Spent. ' }).sent, { continue: false, stopReason: 'Spent.' });
    const bare = rewriteOf('PostToolUse', { continue: false, reason: 'x' });
    assert.deepEqual(bare.sent, { continue: false });
    assert.equal(bare.codex.stopped, true);
    assert.equal(bare.codex.invalid, undefined);
    assert.deepEqual(bare.dropped, ['reason']);
  });
});

describe('the keys every event takes', () => {
  const events = SHARED_HOOK_EVENTS.filter((event) => !['SessionEnd', 'PreToolUse', 'PermissionRequest', 'PostToolUse'].includes(event));

  for (const event of events) {
    it(`${event}: hands on a stop, a quiet flag and a note`, () => {
      const reply = { continue: false, stopReason: 'Spent.', suppressOutput: true, systemMessage: 'Heads up.' };
      const { sent, dropped, codex } = rewriteOf(event, reply);
      assert.deepEqual(sent, reply);
      assert.deepEqual(dropped, []);
      assert.equal(codex.stopped, true);
    });

    it(`${event}: sends no default and reports what it cannot send`, () => {
      assert.deepEqual(codexReply(event, JSON.stringify({ continue: true, suppressOutput: false })), { stdout: '', dropped: [] });
      const mistyped = { continue: 'false', stopReason: 'later', suppressOutput: 1, systemMessage: ['a'], terminalSequence: 'x' };
      assert.deepEqual(codexReply(event, JSON.stringify(mistyped)), { stdout: '', dropped: Object.keys(mistyped) });
    });

    it(`${event}: sends a stop without a blank reason`, () => {
      const { sent, dropped } = rewriteOf(event, { continue: false, stopReason: '  ' });
      assert.deepEqual(sent, { continue: false });
      assert.deepEqual(dropped, ['stopReason']);
    });
  }
});

describe('a compaction', () => {
  it('PreCompact: writes a block as the stop Codex reads there', () => {
    const { sent, codex } = rewriteOf('PreCompact', { decision: 'block', reason: 'Refresh the session instead.' });
    assert.deepEqual(sent, { continue: false, stopReason: 'Refresh the session instead.' });
    assert.equal(codex.stopped, true);
  });

  it('PreCompact: gives a block with no reason one', () => {
    const { sent, dropped } = rewriteOf('PreCompact', { decision: 'block' });
    assert.equal(isRecord(sent) && sent['continue'] === false && typeof sent['stopReason'] === 'string', true);
    assert.deepEqual(dropped, []);
  });

  it("PreCompact: keeps a stop's own reason over the block's", () => {
    const { sent, dropped } = rewriteOf('PreCompact', { continue: false, stopReason: 'Spent.', decision: 'block', reason: 'Refresh instead.' });
    assert.deepEqual(sent, { continue: false, stopReason: 'Spent.' });
    assert.deepEqual(dropped, []);
  });

  it('PreCompact: leaves another decision unused', () => {
    assert.deepEqual(codexReply('PreCompact', JSON.stringify({ decision: 'approve' })), { stdout: '', dropped: ['decision'] });
  });

  it('PostCompact: has no block to hand on', () => {
    const { sent, dropped } = rewriteOf('PostCompact', { decision: 'block', reason: 'late', systemMessage: 'Compacted.' });
    assert.deepEqual(sent, { systemMessage: 'Compacted.' });
    assert.deepEqual(dropped, ['decision', 'reason']);
  });
});

describe('context for the model', () => {
  for (const event of CONTEXT_EVENTS) {
    it(`${event}: wraps a plain text, which Codex refuses bare when it starts like JSON`, () => {
      for (const text of ['Team rules\nline two', '[brackets] name a config key', '{not json', '"quoted"', '42']) {
        const { sent, dropped, codex } = rewriteOfText(event, `\n${text}\n`);
        assert.deepEqual(sent, { hookSpecificOutput: { hookEventName: event, additionalContext: text } });
        assert.deepEqual(dropped, []);
        assert.equal(codex.context, text);
      }
    });

    it(`${event}: reports a hookSpecificOutput field Codex does not take there`, () => {
      const reply = { hookSpecificOutput: { hookEventName: event, additionalContext: 'Team rules', permissionDecision: 'deny' } };
      const { codex, dropped } = rewriteOf(event, reply);
      assert.equal(codex.context, 'Team rules');
      assert.deepEqual(dropped, ['hookSpecificOutput.permissionDecision']);
    });
  }

  it('SessionStart and SubagentStart: have no block to hand on', () => {
    for (const event of ['SessionStart', 'SubagentStart'] as const) {
      assert.deepEqual(codexReply(event, JSON.stringify({ decision: 'block', reason: 'no' })), { stdout: '', dropped: ['decision', 'reason'] });
    }
  });

  it('drops a plain text where Codex reads none', () => {
    for (const event of ['PostToolUse', 'PreCompact', 'PostCompact', 'SubagentStop', 'Stop', 'SessionEnd'] as const) {
      assert.deepEqual(codexReply(event, 'all done'), { stdout: '', dropped: ['(plain text)'] });
      assert.deepEqual(codexReply(event, '{"decision":"bl'), { stdout: '', dropped: ['(plain text)'] });
    }
  });
});

describe("a session's end", () => {
  it('prints nothing, since Codex reads no reply there, and reports every key', () => {
    const reply = { systemMessage: 'Bye.', continue: false, hookSpecificOutput: { hookEventName: 'SessionEnd' }, nothing: null };
    assert.deepEqual(codexReply('SessionEnd', JSON.stringify(reply)), { stdout: '', dropped: ['systemMessage', 'continue', 'hookSpecificOutput'] });
  });
});

/** Replies no hook of teamrig prints, to show no shape of reply makes Codex throw the rewrite away. */
const ODD_REPLIES: readonly unknown[] = [
  ...OWN_REPLIES.map((own) => own.reply),
  ...PRE_TOOL_REFUSALS.map((refusing) => refusing.reply),
  { continue: false },
  { continue: false, stopReason: 5 },
  { continue: null, stopReason: null, suppressOutput: null, systemMessage: null },
  { continue: 'false', suppressOutput: 'true', systemMessage: 5, stopReason: {} },
  { suppressOutput: true, systemMessage: '' },
  { decision: 'block', reason: '' },
  { decision: 'approve', reason: 'ok', hookSpecificOutput: {} },
  { decision: {}, reason: [] },
  { hookSpecificOutput: null },
  { hookSpecificOutput: 5 },
  { hookSpecificOutput: { hookEventName: 'Elsewhere', additionalContext: 'x', updatedMCPToolOutput: {}, updatedToolOutput: {} } },
  { hookSpecificOutput: { decision: { behavior: 'allow', interrupt: 'yes', message: 4 } } },
  { hookSpecificOutput: { decision: { behavior: 'deny', interrupt: true, updatedPermissions: [] } } },
  { hookSpecificOutput: { decision: null, permissionDecision: 'allow', updatedInput: 'ls', permissionDecisionReason: 3 } },
  { hookSpecificOutput: { permissionDecision: 'allow', updatedInput: 0, additionalContext: 'x' }, terminalSequence: 'x' },
  { unknown: { deep: [1, 2, { three: null }] } },
];

describe('whatever a hook printed', () => {
  for (const event of SHARED_HOOK_EVENTS) {
    it(`${event}: Codex takes the rewrite and throws no verdict away`, () => {
      for (const reply of ODD_REPLIES) {
        const { stdout, codex } = rewriteOf(event, reply);
        const shown = `${JSON.stringify(reply)} became ${stdout}`;
        if (event === 'SessionEnd') {
          assert.equal(stdout, '', shown);
          continue;
        }
        assert.equal(codex.taken, stdout !== '', shown);
        assert.equal(codex.invalid, undefined, shown);
      }
    });
  }

  it('reads a key named like a built-in as one more unknown key', () => {
    const text = '{"__proto__":{"decision":"block","reason":"x"},"constructor":"block","toString":1,"hasOwnProperty":false}';
    for (const event of SHARED_HOOK_EVENTS) {
      assert.deepEqual(codexReply(event, text), { stdout: '', dropped: ['__proto__', 'constructor', 'toString', 'hasOwnProperty'] });
    }
  });

  it('refuses a PreToolUse call for every reply that refused it before the rewrite', () => {
    for (const refusing of PRE_TOOL_REFUSALS) {
      const before = codexReads('PreToolUse', JSON.stringify(refusing.reply));
      const after = rewriteOf('PreToolUse', refusing.reply).codex;
      assert.equal(typeof after.refused, 'string', refusing.name);
      // What the rewrite is for: most of these, handed over as printed, run the call.
      assert.equal(before.refused === undefined || before.refused === after.refused, true, refusing.name);
    }
  });
});
