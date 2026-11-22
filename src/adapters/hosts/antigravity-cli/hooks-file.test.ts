import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { antigravityHooksFile, type AntigravityHooksFileOptions, type AntigravityHooksFileResult } from './hooks-file.ts';

const SHIPPED: unknown = JSON.parse(readFileSync(new URL('../../../../plugins/teamrig/hooks/hooks.json', import.meta.url), 'utf8'));

const SH: AntigravityHooksFileOptions = { pluginRoot: '/opt/teamrig/plugin', shell: 'sh' };
const CMD: AntigravityHooksFileOptions = { pluginRoot: 'C:\\Tools\\teamrig plugin', shell: 'cmd' };

function handler(name: string, extra: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/cli/main.js', 'hook', name], ...extra };
}

function fileOf(hooks: Readonly<Record<string, unknown>>): unknown {
  return { description: 'test', modules: ['core'], hooks };
}

function okOf(result: AntigravityHooksFileResult): Extract<AntigravityHooksFileResult, { ok: true }> {
  if (!result.ok) {
    assert.fail(`expected a hooks file, got the refusal: ${result.reason}`);
  }
  return result;
}

function reasonOf(result: AntigravityHooksFileResult): string {
  assert.equal(result.ok, false);
  return result.ok ? '' : result.reason;
}

describe('antigravityHooksFile on the shipped hooks file', () => {
  const { file, skipped } = okOf(antigravityHooksFile(SHIPPED, SH));
  const group = file['teamrig'];

  it('writes one group, named teamrig, holding only events agy fires', () => {
    assert.deepEqual(Object.keys(file), ['teamrig']);
    assert.ok(group !== undefined);
    assert.deepEqual(Object.keys(group).sort(), ['PostToolUse', 'PreInvocation', 'PreToolUse', 'SessionStart', 'Stop']);
  });

  it('puts the plugin path and the agy event on every command line, and no variable', () => {
    const lines = [
      ...(group?.SessionStart ?? []),
      ...(group?.PreInvocation ?? []),
      ...(group?.Stop ?? []),
      ...(group?.PreToolUse ?? []).flatMap((entry) => entry.hooks),
      ...(group?.PostToolUse ?? []).flatMap((entry) => entry.hooks),
    ].map((entry) => entry.command);
    assert.ok(lines.length > 20);
    for (const line of lines) {
      assert.match(line, /^node \/opt\/teamrig\/plugin\/dist\/cli\/(?:guard-)?main\.js hook [a-z-]+ --host antigravity-cli --host-event [A-Za-z]+$/u);
      assert.equal(line.includes('${'), false);
    }
    assert.equal(group?.PreInvocation?.[0]?.command, 'node /opt/teamrig/plugin/dist/cli/main.js hook inbox-reminder --host antigravity-cli --host-event PreInvocation');
  });

  it('runs a typed prompt’s hooks before each model call, as agy has no prompt event', () => {
    assert.deepEqual(
      group?.PreInvocation?.map((entry) => entry.command.split(' ')[3]),
      ['inbox-reminder', 'restore-track', 'tab-status'],
    );
  });

  /** The hooks agy runs before its tool `tool`, by name: what fires when its PreToolUse matcher matches. */
  function guardsBefore(tool: string): readonly string[] {
    return (group?.PreToolUse ?? [])
      .filter((entry) => new RegExp(entry.matcher, 'u').test(tool))
      .flatMap((entry) => entry.hooks.map((hook) => hook.command.split(' ')[3] ?? ''));
  }

  // Found by Yogev Cohen's live agy 1.5.8 e2e on #2142: a Claude Code matcher never fires on agy (T5033).
  const GUARDED: readonly (readonly [string, readonly string[]])[] = [
    ['run_command', ['push-guard', 'package-guard', 'secret-guard', 'db-write-guard', 'exec-guard', 'readonly-allow', 'route-allow', 'picker-guard']],
    ['view_file', ['secret-guard']],
    ['read_file', ['secret-guard']],
    ['grep_search', ['secret-guard']],
    ['write_to_file', ['pass-record-guard', 'service-role-guard', 'secret-guard']],
    ['write_file', ['pass-record-guard', 'service-role-guard', 'secret-guard']],
    ['replace_file_content', ['pass-record-guard', 'service-role-guard', 'secret-guard']],
    ['edit_file', ['pass-record-guard', 'service-role-guard', 'secret-guard']],
    ['multi_replace_file_content', ['pass-record-guard', 'service-role-guard', 'secret-guard']],
    ['send_message', ['cold-send']],
    ['invoke_subagent', ['helper-gate']],
    ['swarm', ['helper-gate']],
    ['ask_question', ['tab-status', 'picker-guard']],
  ];
  for (const [tool, guards] of GUARDED) {
    it(`runs ${guards.join(', ')} before agy's ${tool}`, () => {
      const before = guardsBefore(tool);
      for (const guard of guards) {
        assert.ok(before.includes(guard), `${guard} does not run before ${tool}: ${before.join(', ')}`);
      }
    });
  }

  it('names no Claude Code tool in a matcher, and keeps a hook with no matcher on every tool', () => {
    const matchers = [...(group?.PreToolUse ?? []), ...(group?.PostToolUse ?? [])].map((entry) => entry.matcher);
    for (const matcher of matchers) {
      assert.doesNotMatch(matcher, /Bash|PowerShell|Read|Grep|Write|Edit|SendMessage|Agent|Task|AskUserQuestion/u);
    }
    assert.deepEqual(group?.PreToolUse?.map((entry) => entry.matcher).slice(0, 2), ['run_command', 'run_command']);
    assert.ok(group?.PostToolUse?.some((entry) => entry.matcher === '*'));
  });

  it('keeps every shipped tool hook, as each of its matchers names a tool agy has', () => {
    assert.deepEqual(skipped.filter((entry) => entry.reason === 'tool agy lacks'), []);
  });

  it('lists what it left out, each with its reason', () => {
    const reasons = new Set(skipped.map((entry) => `${entry.event}: ${entry.reason}`));
    for (const expected of [
      'SessionStart: rewake agy lacks',
      'PermissionRequest: event agy lacks',
      'PostToolUseFailure: event agy lacks',
      'SessionEnd: event agy lacks',
      'SubagentStart: event agy lacks',
      'PreCompact: event agy lacks',
    ]) {
      assert.ok(reasons.has(expected), expected);
    }
    assert.deepEqual(
      skipped.find((entry) => entry.reason === 'rewake agy lacks'),
      {
        event: 'SessionStart',
        matcher: 'clear',
        words: ['node', '${CLAUDE_PLUGIN_ROOT}/dist/cli/main.js', 'hook', 'refresh-wake', '--host', 'claude-code'],
        reason: 'rewake agy lacks',
      },
    );
  });

  it('writes the same file for cmd, quoting the path with a space in it', () => {
    const forCmd = okOf(antigravityHooksFile(SHIPPED, CMD)).file['teamrig'];
    assert.equal(
      forCmd?.Stop?.[0]?.command,
      'node "C:\\Tools\\teamrig plugin/dist/cli/main.js" hook stop --host antigravity-cli --host-event Stop',
    );
  });
});

describe('antigravityHooksFile', () => {
  it('puts a tool hook with no matcher on every tool, and a flat event in a flat list', () => {
    const { file } = okOf(antigravityHooksFile(fileOf({ PreToolUse: [{ hooks: [handler('a')] }], Stop: [{ hooks: [handler('b')] }] }), SH));
    assert.deepEqual(file, {
      teamrig: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node /opt/teamrig/plugin/dist/cli/main.js hook a --host antigravity-cli --host-event PreToolUse', timeout: 15 }] }],
        Stop: [{ type: 'command', command: 'node /opt/teamrig/plugin/dist/cli/main.js hook b --host antigravity-cli --host-event Stop', timeout: 15 }],
      },
    });
  });

  it('names agy’s host in place of the one the source line names (T4752)', () => {
    const named = handler('a', { args: ['${CLAUDE_PLUGIN_ROOT}/dist/cli/main.js', 'hook', 'a', '--host', 'claude-code'] });
    const { file } = okOf(antigravityHooksFile(fileOf({ Stop: [{ hooks: [named] }] }), SH));
    assert.equal(file['teamrig']?.Stop?.[0]?.command, 'node /opt/teamrig/plugin/dist/cli/main.js hook a --host antigravity-cli --host-event Stop');
  });

  it('keeps each handler’s own timeout', () => {
    const { file } = okOf(antigravityHooksFile(fileOf({ Stop: [{ hooks: [handler('a', { timeout: 5 })] }] }), SH));
    assert.equal(file['teamrig']?.Stop?.[0]?.timeout, 5);
  });

  it('skips a matcher on an event agy does not match, rather than running it on every firing', () => {
    const { file, skipped } = okOf(antigravityHooksFile(fileOf({ SessionStart: [{ matcher: 'startup', hooks: [handler('a')] }] }), SH));
    assert.deepEqual(file, { teamrig: {} });
    assert.deepEqual(skipped.map((entry) => entry.reason), ['matcher agy cannot hold']);
  });

  it('skips a tool hook when agy has none of the tools its matcher names', () => {
    const { file, skipped } = okOf(antigravityHooksFile(fileOf({ PreToolUse: [{ matcher: 'NotebookEdit|ExitPlanMode', hooks: [handler('a')] }] }), SH));
    assert.deepEqual(file, { teamrig: {} });
    assert.deepEqual(skipped.map((entry) => `${entry.matcher ?? ''}: ${entry.reason}`), ['NotebookEdit|ExitPlanMode: tool agy lacks']);
  });

  it('refuses a tool matcher naming a tool it has no rule for, whole', () => {
    assert.equal(
      reasonOf(antigravityHooksFile(fileOf({ PostToolUse: [{ matcher: 'Bash|LSP', hooks: [handler('a')] }] }), SH)),
      'PostToolUse group 1: the matcher Bash|LSP names the tool LSP, which has no rule for an Antigravity tool',
    );
  });

  it('names the group as asked', () => {
    const { file } = okOf(antigravityHooksFile(fileOf({ Stop: [{ hooks: [handler('a')] }] }), { ...SH, groupName: 'team' }));
    assert.deepEqual(Object.keys(file), ['team']);
  });

  it('quotes a word sh would split, and leaves a percent sign alone there', () => {
    const { file } = okOf(antigravityHooksFile(fileOf({ Stop: [{ hooks: [handler("it's 50%")] }] }), { ...SH, pluginRoot: '/opt/my plugin' }));
    assert.equal(file['teamrig']?.Stop?.[0]?.command, "node '/opt/my plugin/dist/cli/main.js' hook 'it'\\''s 50%' --host antigravity-cli --host-event Stop");
  });

  it('doubles a quoted word’s last backslashes on cmd, so its closing quote stays a quote', () => {
    const source = fileOf({ Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['C:\\my dir\\'] }] }] });
    assert.equal(okOf(antigravityHooksFile(source, CMD)).file['teamrig']?.Stop?.[0]?.command, 'node "C:\\my dir\\\\" --host antigravity-cli --host-event Stop');
  });

  it('refuses a plugin root that is not absolute, or an empty group name', () => {
    assert.equal(reasonOf(antigravityHooksFile(SHIPPED, { ...SH, pluginRoot: 'plugin' })), 'the plugin root is not an absolute path');
    assert.equal(reasonOf(antigravityHooksFile(SHIPPED, { ...SH, groupName: ' ' })), 'the hook group name is empty');
  });

  it('refuses a source it does not know in full, whole', () => {
    const cases: readonly (readonly [unknown, string])[] = [
      [[], 'the hooks file is not a JSON object'],
      [{ hooks: {}, extra: 1 }, 'the hooks file holds the key extra, which the Antigravity hooks file has no rule for'],
      [{ modules: 'core', hooks: {} }, 'the hooks file holds modules that are not a list of strings'],
      [{}, 'the hooks file has no hooks object'],
      [fileOf({ Notification: [] }), 'the hooks file names the event Notification, which the Antigravity hooks file has no rule for'],
      [fileOf({ Stop: {} }), 'the Stop entry is not a list'],
      [fileOf({ Stop: [{ hooks: [handler('a'), { type: 'http', command: 'x' }] }] }), 'Stop group 1, handler 2 is not of type command'],
      [fileOf({ Stop: [{ hooks: [handler('a', { timeout: 0 })] }] }), 'Stop group 1, handler 1 holds a timeout that is not a whole number of seconds above 0'],
      [fileOf({ Stop: [{ hooks: [handler('a', { once: true })] }] }), 'Stop group 1, handler 1 holds the key once, which the Antigravity hooks file has no rule for'],
      [fileOf({ Stop: [{ hooks: [handler('${HOME}')] }] }), 'Stop group 1, handler 1 holds a variable other than ${CLAUDE_PLUGIN_ROOT}, which agy does not fill'],
      [fileOf({ Stop: [{ hooks: [handler('a\nb')] }] }), 'Stop group 1, handler 1 holds a line break, which no command line carries'],
      [fileOf({ Stop: [{ hooks: [handler('')] }] }), 'Stop group 1, handler 1 holds an empty word'],
      [fileOf({ Stop: [{ hooks: [handler('a', { args: ['main.js', 'hook', 'a', '--host'] })] }] }), 'Stop group 1, handler 1 ends with --host and names no host'],
    ];
    for (const [source, reason] of cases) {
      assert.equal(reasonOf(antigravityHooksFile(source, SH)), reason);
    }
  });

  it('refuses on cmd a word cmd cannot carry, or a program name that needs quotes', () => {
    assert.equal(
      reasonOf(antigravityHooksFile(fileOf({ Stop: [{ hooks: [handler('50%')] }] }), CMD)),
      'Stop group 1, handler 1 holds a quote, a percent sign or an exclamation mark, which a cmd line cannot carry as text',
    );
    assert.equal(
      reasonOf(antigravityHooksFile(fileOf({ Stop: [{ hooks: [{ type: 'command', command: 'C:\\my tools\\node.exe' }] }] }), CMD)),
      'Stop group 1, handler 1 starts with a program name that needs quotes on cmd',
    );
  });
});
