import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { isSharedHookEvent, SHARED_HOOK_EVENTS } from './events.ts';
import { codexHooksFile, type CodexHookHandler, type CodexHooksFile, type SkippedHandler } from './hooks-file.ts';

const POSIX_ROOT = '/opt/teamrig/plugin';
const WINDOWS_ROOT = 'C:\\Program Files\\teamrig plugin';
const TEAMRIG_HOOKS_TEXT = readFileSync(new URL('../../../../plugins/teamrig/hooks/hooks.json', import.meta.url), 'utf8');

interface Rewritten {
  readonly file: CodexHooksFile;
  readonly skipped: readonly SkippedHandler[];
}

function rewritten(source: unknown, pluginRoot = POSIX_ROOT): Rewritten {
  const result = codexHooksFile(source, { pluginRoot });
  assert.equal(result.ok, true, result.ok ? '' : result.reason);
  return result.ok ? { file: result.file, skipped: result.skipped } : { file: { hooks: {} }, skipped: [] };
}

function reasonOf(source: unknown, pluginRoot = POSIX_ROOT): string {
  const result = codexHooksFile(source, { pluginRoot });
  assert.equal(result.ok, false);
  return result.ok ? '' : result.reason;
}

function handlersOf(file: CodexHooksFile): readonly CodexHookHandler[] {
  return Object.values(file.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks));
}

/** A hooks file with one Stop handler, the given fields laid over teamrig's usual ones. */
function fileWith(handler: Readonly<Record<string, unknown>>, event = 'Stop'): unknown {
  return { hooks: { [event]: [{ hooks: [{ type: 'command', command: 'node', ...handler }] }] } };
}

function onlyHandler(source: unknown, pluginRoot = POSIX_ROOT): CodexHookHandler {
  const handlers = handlersOf(rewritten(source, pluginRoot).file);
  assert.equal(handlers.length, 1);
  const [handler] = handlers;
  assert.ok(handler);
  return handler;
}

describe("teamrig's own hooks file, rewritten for Codex", () => {
  const source: unknown = JSON.parse(TEAMRIG_HOOKS_TEXT);
  const { file, skipped } = rewritten(source);
  const handlers = handlersOf(file);

  it('holds only the keys Codex takes, so it loads', () => {
    const written: unknown = JSON.parse(JSON.stringify(file));
    assert.deepEqual(Object.keys(written ?? {}), ['hooks']);
    for (const handler of handlers) {
      assert.deepEqual(Object.keys(handler).filter((key) => key !== 'additionalContextLimit'), ['type', 'command', 'commandWindows', 'timeout']);
    }
  });

  it('wires every event the two share and no other', () => {
    assert.deepEqual(Object.keys(file.hooks).sort(), [...SHARED_HOOK_EVENTS].sort());
  });

  it('accounts for every handler: each is in the Codex file or in the skipped list', () => {
    const inSource = TEAMRIG_HOOKS_TEXT.match(/"type": "command"/gu)?.length ?? 0;
    assert.ok(inSource > 40);
    assert.equal(handlers.length + skipped.length, inSource);
  });

  it('skips only the handlers of an event Codex lacks and the rewake', () => {
    for (const entry of skipped) {
      assert.equal(entry.reason, isSharedHookEvent(entry.event) ? 'rewake Codex lacks' : 'event Codex lacks');
    }
    assert.deepEqual(
      skipped.filter((entry) => entry.reason === 'rewake Codex lacks'),
      [{ event: 'SessionStart', matcher: 'clear', words: ['node', '${CLAUDE_PLUGIN_ROOT}/dist/cli/main.js', 'hook', 'refresh-wake', '--host', 'claude-code'], reason: 'rewake Codex lacks' }],
    );
    assert.deepEqual([...new Set(skipped.map((entry) => entry.event))].sort(), ['Elicitation', 'ElicitationResult', 'PostToolUseFailure', 'SessionStart', 'StopFailure']);
  });

  it('leaves no group without a handler', () => {
    assert.deepEqual(file.hooks.SessionStart?.map((group) => group.matcher), [undefined]);
    for (const groups of Object.values(file.hooks)) {
      assert.ok(groups.every((group) => group.hooks.length > 0));
    }
  });

  it('keeps every guard of a shell call under the matcher it had', () => {
    const shell = file.hooks.PreToolUse?.find((group) => group.matcher === 'Bash|PowerShell');
    assert.deepEqual(shell?.hooks.map((handler) => handler.command.split(' ').at(-3)), [
      'push-guard',
      'package-guard',
      'secret-guard',
      'db-write-guard',
      'exec-guard',
      'pass-record-guard',
      'install-guard',
      'service-role-guard',
      'readonly-allow',
    ]);
  });

  it("runs each hook by the plugin's real path, with no variable left for a shell to fill", () => {
    for (const handler of handlers) {
      assert.match(handler.command, /^node \/opt\/teamrig\/plugin\/dist\/cli\/(?:guard-)?main\.js hook [a-z-]+ --host codex-cli$/u);
      assert.equal(handler.commandWindows, handler.command);
    }
  });

  it("keeps each handler's own timeout, but the 3 seconds Codex gives a SessionEnd handler", () => {
    const sessionEnd = (file.hooks.SessionEnd ?? []).flatMap((group) => group.hooks);
    assert.ok(sessionEnd.length > 0);
    assert.ok(sessionEnd.every((handler) => handler.timeout === 3));
    const timeouts = new Set(handlers.filter((handler) => !sessionEnd.includes(handler)).map((handler) => handler.timeout));
    assert.deepEqual([...timeouts].sort((a, b) => a - b), [5, 15]);
    assert.equal(file.hooks.PostToolUse?.at(-1)?.hooks[0]?.timeout, 5);
  });

  it('turns the context limit off on the three events whose context is the team rules or the inbox, and nowhere else', () => {
    for (const [event, groups] of Object.entries(file.hooks)) {
      const expected = ['SessionStart', 'UserPromptSubmit', 'SubagentStart'].includes(event) ? 0 : undefined;
      for (const handler of groups.flatMap((group) => group.hooks)) {
        assert.equal(handler.additionalContextLimit, expected, event);
      }
    }
  });
});

describe('a Codex hook command line', () => {
  it('quotes a path with a space for each shell', () => {
    const handler = onlyHandler(fileWith({ args: ['${CLAUDE_PLUGIN_ROOT}/dist/cli/main.js', 'hook', 'stop'] }), WINDOWS_ROOT);
    assert.equal(handler.command, "node 'C:\\Program Files\\teamrig plugin/dist/cli/main.js' hook stop --host codex-cli");
    assert.equal(handler.commandWindows, 'node "C:\\Program Files\\teamrig plugin/dist/cli/main.js" hook stop --host codex-cli');
  });

  it('doubles the backslashes before a closing cmd quote, so the quote still closes', () => {
    const handler = onlyHandler(fileWith({ args: ['${CLAUDE_PLUGIN_ROOT}\\'] }), 'C:\\team rig\\');
    assert.equal(handler.commandWindows, 'node "C:\\team rig\\\\\\\\" --host codex-cli');
    assert.equal(handler.command, "node 'C:\\team rig\\\\' --host codex-cli");
  });

  it('carries a single quote through both shells', () => {
    const handler = onlyHandler(fileWith({ args: ["it's"] }));
    assert.equal(handler.command, "node 'it'\\''s' --host codex-cli");
    assert.equal(handler.commandWindows, 'node "it\'s" --host codex-cli');
  });

  it('quotes a word cmd would split or run, which a POSIX shell takes plain', () => {
    const handler = onlyHandler(fileWith({ args: ['a=b,c', 'x&y'] }));
    assert.equal(handler.command, "node a=b,c 'x&y' --host codex-cli");
    assert.equal(handler.commandWindows, 'node "a=b,c" "x&y" --host codex-cli');
  });

  it('fills the plugin root wherever a word names it', () => {
    const handler = onlyHandler(fileWith({ args: ['--root=${CLAUDE_PLUGIN_ROOT}', '${CLAUDE_PLUGIN_ROOT}/a:${CLAUDE_PLUGIN_ROOT}/b'] }));
    assert.equal(handler.command, 'node --root=/opt/teamrig/plugin /opt/teamrig/plugin/a:/opt/teamrig/plugin/b --host codex-cli');
  });

  it('names the Codex host in place of the host the source line names, wherever the pair sits', () => {
    const handler = onlyHandler(fileWith({ args: ['main.js', 'hook', '--host', 'claude-code', 'stop'] }));
    assert.equal(handler.command, 'node main.js hook stop --host codex-cli');
    assert.equal(onlyHandler(fileWith({ args: ['--host', 'antigravity-cli'] })).command, 'node --host codex-cli');
  });

  it('runs a handler with no args as its command and the Codex host alone', () => {
    const handler = onlyHandler(fileWith({}));
    assert.deepEqual(handler, { type: 'command', command: 'node --host codex-cli', commandWindows: 'node --host codex-cli', timeout: 15 });
  });
});

describe('a Codex hooks file', () => {
  it('carries a description only when one is given', () => {
    const given = codexHooksFile({ description: 'the Claude Code one', hooks: {} }, { pluginRoot: POSIX_ROOT, description: 'teamrig on Codex' });
    assert.deepEqual(given, { ok: true, file: { description: 'teamrig on Codex', hooks: {} }, skipped: [] });
    assert.deepEqual(rewritten({ description: 'the Claude Code one', modules: ['./register.ts'], hooks: {} }).file, { hooks: {} });
  });

  it('gives a handler with no timeout 15 seconds, far under the 600 of Codex', () => {
    assert.equal(onlyHandler(fileWith({ timeout: 30 })).timeout, 30);
    assert.equal(onlyHandler(fileWith({})).timeout, 15);
  });

  it('writes a SessionEnd timeout of at most the 3 seconds Codex clamps it to, keeping a shorter one', () => {
    assert.equal(onlyHandler(fileWith({ timeout: 15 }, 'SessionEnd')).timeout, 3);
    assert.equal(onlyHandler(fileWith({}, 'SessionEnd')).timeout, 3);
    assert.equal(onlyHandler(fileWith({ timeout: 2 }, 'SessionEnd')).timeout, 2);
  });

  it('keeps a matcher as it is', () => {
    const source = { hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'node' }] }] } };
    assert.deepEqual(rewritten(source).file.hooks.PreToolUse?.map((group) => group.matcher), ['Bash|PowerShell']);
  });

  it('lists a skipped handler with its event, matcher and words', () => {
    const source = {
      hooks: {
        PostToolUseFailure: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/x.js'] }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['wake'], asyncRewake: true }] }],
      },
    };
    assert.deepEqual(rewritten(source), {
      file: { hooks: {} },
      skipped: [
        { event: 'PostToolUseFailure', matcher: 'Bash', words: ['node', '${CLAUDE_PLUGIN_ROOT}/x.js'], reason: 'event Codex lacks' },
        { event: 'Stop', words: ['node', 'wake'], reason: 'rewake Codex lacks' },
      ],
    });
  });

  it('keeps a handler whose asyncRewake is false', () => {
    assert.equal(onlyHandler(fileWith({ asyncRewake: false })).command, 'node --host codex-cli');
  });

  it('does not check the words of a handler it skips', () => {
    assert.equal(rewritten(fileWith({ args: ['50%'] }, 'StopFailure')).skipped.length, 1);
  });
});

describe('a hooks file the rewrite does not know in full is refused whole', () => {
  const cases: readonly (readonly [string, unknown, RegExp])[] = [
    ['a file that is not an object', ['hooks'], /the hooks file is not a JSON object/u],
    ['a top-level key with no rule', { hooks: {}, statusLine: {} }, /the hooks file holds the key statusLine/u],
    ['a description that is not a string', { description: 3, hooks: {} }, /a description that is not a string/u],
    ['modules that are not strings', { modules: [1], hooks: {} }, /modules that are not a list of strings/u],
    ['a file with no hooks', { description: 'none' }, /has no hooks object/u],
    ['an event with no rule', { hooks: { Notification: [] } }, /names the event Notification/u],
    ['an event that is not a list', { hooks: { Stop: {} } }, /the Stop entry is not a list/u],
    ['a group that is not an object', { hooks: { Stop: ['x'] } }, /Stop group 1 is not a JSON object/u],
    ['a group key with no rule', { hooks: { Stop: [{ hooks: [], if: 'x' }] } }, /Stop group 1 holds the key if/u],
    ['a matcher that is not a string', { hooks: { Stop: [{ matcher: 1, hooks: [] }] } }, /a matcher that is not a string/u],
    ['a group with no hooks list', { hooks: { Stop: [{ matcher: 'x' }] } }, /Stop group 1's hooks is not a list/u],
    ['a handler key with no rule', fileWith({ async: true }), /Stop group 1, handler 1 holds the key async/u],
    ['a handler of another type', fileWith({ type: 'prompt' }), /is not of type command/u],
    ['a handler with no command', fileWith({ command: undefined }), /has no command/u],
    ['args that are not strings', fileWith({ args: ['hook', 1] }), /args that are not a list of strings/u],
    ['a timeout of 0', fileWith({ timeout: 0 }), /a timeout that is not a whole number of seconds above 0/u],
    ['a timeout with a fraction', fileWith({ timeout: 1.5 }), /a timeout that is not a whole number/u],
    ['a timeout in a string', fileWith({ timeout: '15' }), /a timeout that is not a whole number/u],
    ['an asyncRewake that is not a boolean', fileWith({ asyncRewake: 'yes' }), /an asyncRewake that is not true or false/u],
    ['an empty command', fileWith({ command: '' }), /holds an empty word/u],
    ['an empty argument', fileWith({ args: [''] }), /holds an empty word/u],
    ['a variable Codex does not fill', fileWith({ args: ['${CLAUDE_PROJECT_DIR}/x'] }), /a variable other than \$\{CLAUDE_PLUGIN_ROOT\}/u],
    ['a line break in a word', fileWith({ args: ['a\nb'] }), /holds a line break/u],
    ['a percent sign in a word', fileWith({ args: ['%PATH%'] }), /a cmd line cannot carry as text/u],
    ['a double quote in a word', fileWith({ args: ['say "hi"'] }), /a cmd line cannot carry as text/u],
    ['an exclamation mark in a word', fileWith({ args: ['now!'] }), /a cmd line cannot carry as text/u],
    ['a program name that needs quotes', fileWith({ command: 'my node' }), /starts with a program name that needs quotes on cmd/u],
    ['a --host flag naming no host', fileWith({ args: ['hook', 'stop', '--host'] }), /ends with --host and names no host/u],
  ];

  for (const [name, source, reason] of cases) {
    it(`refuses ${name}`, () => {
      assert.match(reasonOf(source), reason);
    });
  }

  it('names the group and handler at fault by their place in the file', () => {
    const good = { type: 'command', command: 'node' };
    const source = { hooks: { PreToolUse: [{ hooks: [good] }, { hooks: [good, { ...good, args: ['a\rb'] }] }] } };
    assert.match(reasonOf(source), /^PreToolUse group 2, handler 2 holds a line break/u);
  });

  it('refuses a plugin root a shell cannot carry', () => {
    assert.match(reasonOf(fileWith({ args: ['${CLAUDE_PLUGIN_ROOT}/x'] }), '/opt/100%/plugin'), /a cmd line cannot carry as text/u);
  });

  for (const root of ['', 'plugins/teamrig', './plugin', 'C:plugin']) {
    it(`refuses the plugin root "${root}", which is not absolute`, () => {
      assert.equal(reasonOf({ hooks: {} }, root), 'the plugin root is not an absolute path');
    });
  }

  for (const root of ['/opt/plugin', 'C:\\plugin', 'c:/plugin', '\\\\host\\share\\plugin']) {
    it(`takes the absolute plugin root ${root}`, () => {
      assert.deepEqual(rewritten({ hooks: {} }, root), { file: { hooks: {} }, skipped: [] });
    });
  }
});
