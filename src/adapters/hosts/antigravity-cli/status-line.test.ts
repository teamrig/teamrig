import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compoundOperator, launcherCommand, planInstall, planUninstall, statusLine } from './status-line.ts';

const LAUNCHER = 'C:\\Users\\me\\.teamrig\\bin\\statusline.mjs';
const OWN = 'node "C:/Users/me/.teamrig/bin/statusline.mjs"';
const THEIRS = 'node "C:/Users/me/.gemini/scripts/status.cjs"';
const ON = { enabled: true, stack_with_default: true };

describe('launcherCommand', () => {
  it('runs the launcher with Node, its path quoted with forward slashes', () => {
    assert.equal(launcherCommand(LAUNCHER), OWN);
    assert.equal(launcherCommand('/home/me/.teamrig/bin/statusline.mjs'), 'node "/home/me/.teamrig/bin/statusline.mjs"');
  });
});

describe('planInstall', () => {
  it("makes the launcher the status line when there is none, beside agy's own, keeping the other settings", () => {
    assert.deepEqual(planInstall({ model: 'gemini' }, LAUNCHER), {
      ok: true,
      value: { settings: { model: 'gemini', statusLine: { type: 'command', ...ON, command: OWN } }, before: undefined, after: OWN },
    });
  });

  it('puts the launcher in front of a status line already there, switching it on and keeping its other fields', () => {
    const plan = planInstall({ statusLine: { type: 'command', command: THEIRS, padding: 1, enabled: false } }, LAUNCHER);
    const after = `${OWN} --pass | ${THEIRS}`;
    assert.deepEqual(plan, { ok: true, value: { settings: { statusLine: { type: 'command', command: after, padding: 1, ...ON } }, before: THEIRS, after } });
  });

  it('changes nothing when the launcher is already the status line, on and stacked', () => {
    for (const command of [OWN, `${OWN} --pass | ${THEIRS}`]) {
      assert.deepEqual(planInstall({ statusLine: { type: 'command', command, ...ON } }, LAUNCHER), {
        ok: true,
        value: { settings: undefined, before: command, after: command },
      });
    }
  });

  it('switches the launcher back on, or stacks it, when someone turned that off', () => {
    for (const fields of [{ enabled: false, stack_with_default: true }, { enabled: true }]) {
      assert.deepEqual(planInstall({ statusLine: { type: 'command', command: OWN, ...fields } }, LAUNCHER), {
        ok: true,
        value: { settings: { statusLine: { type: 'command', command: OWN, ...ON } }, before: OWN, after: OWN },
      });
    }
  });

  it('puts the bare launcher back when its --pass has nothing piped after it', () => {
    for (const command of [`${OWN} --pass`, `${OWN} --pass | `, `${OWN} --pass|`]) {
      assert.deepEqual(planInstall({ statusLine: { type: 'command', command, padding: 1 } }, LAUNCHER), {
        ok: true,
        value: { settings: { statusLine: { type: 'command', command: OWN, padding: 1, ...ON } }, before: command, after: OWN },
      });
    }
  });

  it("refuses a compound shell line, cmd's lone & among them, and a status line without a command", () => {
    for (const [command, named] of [['cd ~ && ./status.sh', '"&&"'], ['status.cmd & echo done', '"&"']] as const) {
      const plan = planInstall({ statusLine: { type: 'command', command } }, LAUNCHER);
      assert.match(plan.ok ? '' : plan.problem, new RegExp(`shell line with ${named}`), command);
    }
    for (const line of [{ type: 'command' }, 'node x.js']) {
      assert.deepEqual(planInstall({ statusLine: line }, LAUNCHER), { ok: false, problem: 'statusLine has no command string, so nothing can be added in front of it' });
    }
  });
});

describe('planUninstall', () => {
  it('hands the status line back to the command that was there before', () => {
    const before = `${OWN} --pass | ${THEIRS}`;
    assert.deepEqual(planUninstall({ statusLine: { type: 'command', command: before, padding: 1, ...ON } }, LAUNCHER), {
      ok: true,
      value: { settings: { statusLine: { type: 'command', command: THEIRS, padding: 1, ...ON } }, before, after: THEIRS },
    });
  });

  it('removes the status line when the launcher was alone, or passed its input on to nothing', () => {
    for (const before of [OWN, `${OWN} --pass`, `${OWN} --pass | `]) {
      assert.deepEqual(planUninstall({ model: 'gemini', statusLine: { type: 'command', command: before } }, LAUNCHER), {
        ok: true,
        value: { settings: { model: 'gemini' }, before, after: undefined },
      });
    }
  });

  it('changes nothing when the launcher is not the status line', () => {
    for (const settings of [{}, { statusLine: { type: 'command', command: THEIRS } }]) {
      const before = settings.statusLine?.command;
      assert.deepEqual(planUninstall(settings, LAUNCHER), { ok: true, value: { settings: undefined, before, after: before } });
    }
  });

  it('refuses a launcher line changed by hand', () => {
    const plan = planUninstall({ statusLine: { type: 'command', command: `${OWN} --verbose` } }, LAUNCHER);
    assert.match(plan.ok ? '' : plan.problem, /changed by hand/);
  });
});

describe('statusLine', () => {
  /** Written from agy's status-line docs page as read 2026-11-20, not recorded; the live read (T4770) replaces it. */
  const DOCS_BUILT = {
    session_id: 'session-1',
    conversation_id: 'conversation-1',
    conversation_title: 'Fix the build',
    transcript_path: '/work/.gemini/brain/conversation-1/transcript.jsonl',
    cwd: '/work/project',
    model: 'gemini-3-pro-high',
    cost: { total_usd: 1.25, subagent_usd: 0, estimated: true },
    context_window: { used_percentage: 42, context_window_size: 1_000_000 },
    agent_state: 'working',
  };

  it('names the setting its plans change, and plans by planInstall and planUninstall', () => {
    assert.equal(statusLine.setting, 'statusLine');
    assert.deepEqual(statusLine.install({}, LAUNCHER), planInstall({}, LAUNCHER));
    const installed = { statusLine: { type: 'command', command: OWN } };
    assert.deepEqual(statusLine.uninstall(installed, LAUNCHER), planUninstall(installed, LAUNCHER));
  });

  it('reads the session, folder, model and context share, and leaves the estimated cost unread', () => {
    assert.deepEqual(statusLine.parse(`  ${JSON.stringify(DOCS_BUILT)}\n`), {
      sessionId: 'session-1',
      cwd: '/work/project',
      agentName: undefined,
      model: 'gemini-3-pro-high',
      effort: undefined,
      hostVersion: undefined,
      costUsd: undefined,
      contextUsedPct: 42,
      contextInputTokens: undefined,
    });
  });

  it('leaves a field the input did not tell, or told in the wrong type, undefined and the folder empty', () => {
    const bare = { sessionId: undefined, cwd: '', agentName: undefined, model: undefined, effort: undefined, hostVersion: undefined, costUsd: undefined, contextUsedPct: undefined, contextInputTokens: undefined };
    assert.deepEqual(statusLine.parse('{}'), bare);
    const wrong = { session_id: ' ', cwd: 3, model: { name: 'gemini' }, context_window: { used_percentage: Number.NaN } };
    assert.deepEqual(statusLine.parse(JSON.stringify(wrong)), bare);
  });

  it('reads nothing from a text that is no JSON object', () => {
    for (const input of ['', 'not json', '[1]', '"text"', 'null']) {
      assert.equal(statusLine.parse(input), undefined, input);
    }
  });
});

describe('compoundOperator', () => {
  it('finds &&, ||, ;, line breaks and a lone & outside quotes', () => {
    assert.equal(compoundOperator('a && b'), '"&&"');
    assert.equal(compoundOperator('a || b'), '"||"');
    assert.equal(compoundOperator('a; b'), '";"');
    assert.equal(compoundOperator('a\nb'), 'a line break');
    assert.equal(compoundOperator('a & b'), '"&"');
  });

  it('allows pipes, redirects and operators inside quotes or escaped', () => {
    for (const command of ['jq -r .model | xargs echo', 'node x.js 2>&1', 'node x.js <&0', 'bash -c "a; b && c & d"', "sh -c 'a || b'", 'echo a\\;b', THEIRS]) {
      assert.equal(compoundOperator(command), undefined, command);
    }
  });
});
