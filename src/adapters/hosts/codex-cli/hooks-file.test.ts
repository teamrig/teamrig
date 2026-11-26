import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { HookLauncher } from '../../../plugin-api/index.ts';
import { isSharedHookEvent, SHARED_HOOK_EVENTS } from './events.ts';
import { codexHooksFile, type CodexHookHandler, type CodexHooksFile, type SkippedHandler } from './hooks-file.ts';

const POSIX_LAUNCHER = '/srv/a/.teamrig/bin/teamrig.mjs';
const WINDOWS_LAUNCHER = 'D:\\kit\\a b\\.teamrig\\bin\\teamrig.mjs';
const MAIN = '${CLAUDE_PLUGIN_ROOT}/dist/cli/main.js';
/** The words every line of a Stop handler running the main entry starts with. */
const STOP_LINE = `node ${POSIX_LAUNCHER} --launcher-entry main --launcher-event Stop`;
const TEAMRIG_HOOKS_TEXT = readFileSync(new URL('../../../../plugins/teamrig/hooks/hooks.json', import.meta.url), 'utf8');

function launcherAt(path: string): HookLauncher {
  return {
    path,
    entryFlag: '--launcher-entry',
    eventFlag: '--launcher-event',
    entries: new Map([
      ['dist/cli/main.js', 'main'],
      ['dist/cli/guard-main.js', 'guard-main'],
    ]),
  };
}

interface Rewritten {
  readonly file: CodexHooksFile;
  readonly skipped: readonly SkippedHandler[];
}

function rewritten(source: unknown, launcherPath = POSIX_LAUNCHER): Rewritten {
  const result = codexHooksFile(source, { launcher: launcherAt(launcherPath) });
  assert.equal(result.ok, true, result.ok ? '' : result.reason);
  return result.ok ? { file: result.file, skipped: result.skipped } : { file: { hooks: {} }, skipped: [] };
}

function reasonOf(source: unknown, launcherPath = POSIX_LAUNCHER): string {
  const result = codexHooksFile(source, { launcher: launcherAt(launcherPath) });
  assert.equal(result.ok, false);
  return result.ok ? '' : result.reason;
}

function handlersOf(file: CodexHooksFile): readonly CodexHookHandler[] {
  return Object.values(file.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks));
}

/** A hooks file with one Stop handler running the main entry, the given fields laid over teamrig's usual ones. */
function fileWith(handler: Readonly<Record<string, unknown>>, event = 'Stop'): unknown {
  return { hooks: { [event]: [{ hooks: [{ type: 'command', command: 'node', args: [MAIN], ...handler }] }] } };
}

/** A hooks file with one Stop handler running the main entry with `words` after it. */
function fileWithWords(words: readonly string[], event = 'Stop'): unknown {
  return fileWith({ args: [MAIN, ...words] }, event);
}

function onlyHandler(source: unknown, launcherPath = POSIX_LAUNCHER): CodexHookHandler {
  const handlers = handlersOf(rewritten(source, launcherPath).file);
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

  it('keeps every guard of a shell call under the matcher it had, the set of guards as one handler (T5553)', () => {
    const shell = file.hooks.PreToolUse?.find((group) => group.matcher === 'Bash|PowerShell');
    const hooksOf = (command: string): readonly string[] => command.split(' hook ')[1]?.split(' --host ')[0]?.split(' ') ?? [];
    assert.deepEqual(shell?.hooks.map((handler) => hooksOf(handler.command)), [
      ['guards', 'push-guard', 'package-guard', 'secret-guard', 'db-write-guard', 'exec-guard', 'pass-record-guard', 'install-guard', 'service-role-guard'],
      ['readonly-allow'],
    ]);
  });

  it('runs each hook through the kit launcher, naming its entry and its event, with no plugin folder or variable left', () => {
    for (const [event, groups] of Object.entries(file.hooks)) {
      for (const handler of groups.flatMap((group) => group.hooks)) {
        const line = new RegExp(`^node /srv/a/\\.teamrig/bin/teamrig\\.mjs --launcher-entry (?:guard-)?main --launcher-event ${event} hook (?:guards(?: [a-z-]+)+|[a-z-]+) --host codex-cli$`, 'u');
        assert.match(handler.command, line);
        assert.equal(handler.commandWindows, handler.command);
      }
    }
  });

  it('never names a plugin folder, so no update changes a line Codex trusts (T5278)', () => {
    const text = JSON.stringify(file);
    assert.doesNotMatch(text, /dist\/cli|CLAUDE_PLUGIN_ROOT|plugins\//u);
    assert.deepEqual(rewritten(source).file, file);
  });

  it('runs the guard entry for the handlers whose source names guard-main.js', () => {
    const guards = TEAMRIG_HOOKS_TEXT.match(/dist\/cli\/guard-main\.js/gu)?.length ?? 0;
    assert.ok(guards > 0);
    assert.equal(handlers.filter((handler) => handler.command.includes('--launcher-entry guard-main ')).length, guards);
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
  it('quotes a launcher path with a space for each shell', () => {
    const handler = onlyHandler(fileWithWords(['hook', 'stop']), WINDOWS_LAUNCHER);
    const rest = '--launcher-entry main --launcher-event Stop hook stop --host codex-cli';
    assert.equal(handler.command, `node 'D:\\kit\\a b\\.teamrig\\bin\\teamrig.mjs' ${rest}`);
    assert.equal(handler.commandWindows, `node "D:\\kit\\a b\\.teamrig\\bin\\teamrig.mjs" ${rest}`);
  });

  it('doubles the backslashes before a closing cmd quote, so the quote still closes', () => {
    const handler = onlyHandler(fileWithWords(['C:\\team rig\\']));
    assert.equal(handler.commandWindows, `${STOP_LINE} "C:\\team rig\\\\" --host codex-cli`);
    assert.equal(handler.command, `${STOP_LINE} 'C:\\team rig\\' --host codex-cli`);
  });

  it('carries a single quote through both shells', () => {
    const handler = onlyHandler(fileWithWords(["it's"]));
    assert.equal(handler.command, `${STOP_LINE} 'it'\\''s' --host codex-cli`);
    assert.equal(handler.commandWindows, `${STOP_LINE} "it's" --host codex-cli`);
  });

  it('quotes a word cmd would split or run, which a POSIX shell takes plain', () => {
    const handler = onlyHandler(fileWithWords(['a=b,c', 'x&y']));
    assert.equal(handler.command, `${STOP_LINE} a=b,c 'x&y' --host codex-cli`);
    assert.equal(handler.commandWindows, `${STOP_LINE} "a=b,c" "x&y" --host codex-cli`);
  });

  it('names the event the handler is under, which sets the exit a failed check ends with', () => {
    const handler = onlyHandler(fileWithWords(['hook', 'pre'], 'PreToolUse'));
    assert.equal(handler.command, `node ${POSIX_LAUNCHER} --launcher-entry main --launcher-event PreToolUse hook pre --host codex-cli`);
  });

  it('names the Codex host in place of the host the source line names, wherever the pair sits', () => {
    const handler = onlyHandler(fileWithWords(['hook', '--host', 'claude-code', 'stop']));
    assert.equal(handler.command, `${STOP_LINE} hook stop --host codex-cli`);
    assert.equal(onlyHandler(fileWith({ args: ['--host', 'antigravity-cli', MAIN] })).command, `${STOP_LINE} --host codex-cli`);
  });

  it('runs a handler naming only its entry script as the launcher and the Codex host alone', () => {
    const handler = onlyHandler(fileWith({}));
    assert.deepEqual(handler, { type: 'command', command: `${STOP_LINE} --host codex-cli`, commandWindows: `${STOP_LINE} --host codex-cli`, timeout: 15 });
  });
});

describe('a Codex hooks file', () => {
  it('carries a description only when one is given', () => {
    const given = codexHooksFile({ description: 'the Claude Code one', hooks: {} }, { launcher: launcherAt(POSIX_LAUNCHER), description: 'teamrig on Codex' });
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
    const source = { hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'node', args: [MAIN] }] }] } };
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
    assert.equal(onlyHandler(fileWith({ asyncRewake: false })).command, `${STOP_LINE} --host codex-cli`);
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
    ['an empty argument', fileWithWords(['']), /holds an empty word/u],
    ['a variable Codex does not fill', fileWithWords(['${CLAUDE_PROJECT_DIR}/x']), /a variable other than \$\{CLAUDE_PLUGIN_ROOT\}/u],
    ['a line break in a word', fileWithWords(['a\nb']), /holds a line break/u],
    ['a percent sign in a word', fileWithWords(['%PATH%']), /a cmd line cannot carry as text/u],
    ['a double quote in a word', fileWithWords(['say "hi"']), /a cmd line cannot carry as text/u],
    ['an exclamation mark in a word', fileWithWords(['now!']), /a cmd line cannot carry as text/u],
    ['a program name that needs quotes', fileWith({ command: 'my node' }), /starts with a program name that needs quotes on cmd/u],
    ['a handler naming no script', fileWith({ args: [] }), /runs no script, which is no entry script the kit launcher runs/u],
    ['a script that is no entry of the launcher', fileWith({ args: ['${CLAUDE_PLUGIN_ROOT}/dist/cli/other.js'] }), /runs \$\{CLAUDE_PLUGIN_ROOT\}\/dist\/cli\/other\.js, which is no entry/u],
    ['an entry script outside the plugin folder', fileWith({ args: ['/opt/old/dist/cli/main.js'] }), /runs \/opt\/old\/dist\/cli\/main\.js, which is no entry/u],
    ['the plugin folder past the script', fileWithWords(['--root=${CLAUDE_PLUGIN_ROOT}']), /names \$\{CLAUDE_PLUGIN_ROOT\} past its script, which a launcher line never holds/u],
    ['a --host flag naming no host', fileWith({ args: ['hook', 'stop', '--host'] }), /ends with --host and names no host/u],
  ];

  for (const [name, source, reason] of cases) {
    it(`refuses ${name}`, () => {
      assert.match(reasonOf(source), reason);
    });
  }

  it('names the group and handler at fault by their place in the file', () => {
    const good = { type: 'command', command: 'node', args: [MAIN] };
    const source = { hooks: { PreToolUse: [{ hooks: [good] }, { hooks: [good, { ...good, args: [MAIN, 'a\rb'] }] }] } };
    assert.match(reasonOf(source), /^PreToolUse group 2, handler 2 holds a line break/u);
  });

  it('refuses a launcher path a shell cannot carry', () => {
    assert.match(reasonOf(fileWith({}), '/opt/100%/bin/teamrig.mjs'), /a cmd line cannot carry as text/u);
  });

  for (const path of ['', 'bin/teamrig.mjs', './teamrig.mjs', 'C:teamrig.mjs']) {
    it(`refuses the launcher path "${path}", which is not absolute`, () => {
      assert.equal(reasonOf({ hooks: {} }, path), 'the kit launcher path is not an absolute path');
    });
  }

  for (const path of ['/opt/bin/teamrig.mjs', 'C:\\kit\\bin\\teamrig.mjs', 'c:/kit/bin/teamrig.mjs', '\\\\host\\share\\teamrig.mjs']) {
    it(`takes the absolute launcher path ${path}`, () => {
      assert.deepEqual(rewritten({ hooks: {} }, path), { file: { hooks: {} }, skipped: [] });
    });
  }
});
