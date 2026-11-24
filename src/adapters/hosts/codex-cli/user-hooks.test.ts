import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { JsonRecord, UserHooksPlan } from '../../../plugin-api/index.ts';
import { codexUserHooks } from './user-hooks.ts';

const ROOT = '/opt/teamrig/plugin';
const OLD_ROOT = '/opt/teamrig/old-plugin';
const WINDOWS_ROOT = 'D:\\Program Files\\teamrig plugin';

const port = codexUserHooks({}, 'linux');

/** A plugin hooks file as teamrig ships it: each handler runs `node <root>/dist/cli/<script> hook <name>`. */
function source(handlers: Readonly<Record<string, readonly string[]>>): unknown {
  return {
    hooks: Object.fromEntries(
      Object.entries(handlers).map(([event, names]) => [
        event,
        [{ hooks: names.map((name) => ({ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/cli/main.js', 'hook', name], timeout: 15 })) }],
      ]),
    ),
  };
}

function planOf(current: JsonRecord, from: unknown, root = ROOT): UserHooksPlan {
  const answer = port.merge(current, from, root);
  assert.equal(answer.ok, true, answer.ok ? '' : answer.problem);
  return answer.ok ? answer.value : { file: undefined, counts: { inserted: 0, unchanged: 0, changed: 0, removed: 0 }, skipped: [] };
}

function problemOf(current: JsonRecord, from: unknown): string {
  const answer = port.merge(current, from, ROOT);
  assert.equal(answer.ok, false);
  return answer.ok ? '' : answer.problem;
}

function written(plan: UserHooksPlan): JsonRecord {
  assert.ok(plan.file, 'the merge leaves the file as it was');
  return plan.file;
}

const PERSONS_HANDLER = { type: 'command', command: 'echo started', timeout: 5 };
const SHIPPED = source({ SessionStart: ['session-start', 'tab-status'], Stop: ['stop'] });

describe('codexUserHooks.merge', () => {
  it("puts teamrig's handlers into an empty file and counts each as inserted", () => {
    const plan = planOf({}, SHIPPED);
    assert.deepEqual(plan.counts, { inserted: 3, unchanged: 0, changed: 0, removed: 0 });
    assert.deepEqual(plan.skipped, []);
    const file = written(plan);
    assert.deepEqual(Object.keys(file), ['hooks']);
    assert.match(JSON.stringify(file), /node \/opt\/teamrig\/plugin\/dist\/cli\/main\.js hook session-start/u);
  });

  it('leaves a merged file as it is on a second run: all unchanged and no file to write', () => {
    const first = written(planOf({}, SHIPPED));
    const again = planOf(first, SHIPPED);
    assert.deepEqual(again.counts, { inserted: 0, unchanged: 3, changed: 0, removed: 0 });
    assert.equal(again.file, undefined);
  });

  it("keeps the person's own handlers and keys, beside teamrig's", () => {
    const current: JsonRecord = { description: 'mine', hooks: { SessionStart: [{ hooks: [PERSONS_HANDLER] }], UserPromptSubmit: [{ hooks: [PERSONS_HANDLER] }] } };
    const file = written(planOf(current, SHIPPED));
    assert.equal(file['description'], 'mine');
    const hooks = file['hooks'];
    assert.ok(hooks !== null && typeof hooks === 'object' && !Array.isArray(hooks));
    assert.deepEqual(Reflect.get(hooks, 'UserPromptSubmit'), [{ hooks: [PERSONS_HANDLER] }]);
    const sessionStart: unknown = Reflect.get(hooks, 'SessionStart');
    assert.ok(Array.isArray(sessionStart));
    assert.deepEqual(sessionStart[0], { hooks: [PERSONS_HANDLER] });
    assert.equal(sessionStart.length, 2);
  });

  it('counts a handler written for another plugin root as changed and rewrites it', () => {
    const old = written(planOf({}, SHIPPED, OLD_ROOT));
    const plan = planOf(old, SHIPPED);
    assert.deepEqual(plan.counts, { inserted: 0, unchanged: 0, changed: 3, removed: 0 });
    const text = JSON.stringify(written(plan));
    assert.doesNotMatch(text, /old-plugin/u);
  });

  it('takes out a handler teamrig no longer ships, and drops a group that held only teamrig handlers', () => {
    const old = written(planOf({}, source({ SessionStart: ['session-start'], PostToolUse: ['gone'] })));
    const plan = planOf(old, source({ SessionStart: ['session-start'] }));
    assert.deepEqual(plan.counts, { inserted: 0, unchanged: 1, changed: 0, removed: 1 });
    const hooks = written(plan)['hooks'];
    assert.ok(hooks !== null && typeof hooks === 'object');
    assert.equal(Reflect.get(hooks, 'PostToolUse'), undefined);
  });

  it("keeps the person's handler in a group it shared with a teamrig handler that is gone", () => {
    const old = written(planOf({}, source({ Stop: ['stop'] })));
    const hooks = old['hooks'];
    assert.ok(hooks !== null && typeof hooks === 'object');
    const stop: unknown = Reflect.get(hooks, 'Stop');
    assert.ok(Array.isArray(stop) && stop[0] !== null && typeof stop[0] === 'object');
    const ours: unknown = Reflect.get(stop[0], 'hooks');
    assert.ok(Array.isArray(ours));
    const shared: JsonRecord = { hooks: { Stop: [{ hooks: [PERSONS_HANDLER, ...ours] }] } };
    const plan = planOf(shared, source({}));
    assert.deepEqual(plan.counts, { inserted: 0, unchanged: 0, changed: 0, removed: 1 });
    assert.deepEqual(written(plan)['hooks'], { Stop: [{ hooks: [PERSONS_HANDLER] }] });
  });

  it('keeps an empty event list the person wrote', () => {
    const file = written(planOf({ hooks: { Stop: [] } }, source({ SessionStart: ['session-start'] })));
    const hooks = file['hooks'];
    assert.ok(hooks !== null && typeof hooks === 'object');
    assert.deepEqual(Reflect.get(hooks, 'Stop'), []);
  });

  it('recognises its handlers under a quoted Windows plugin root', () => {
    const first = written(planOf({}, SHIPPED, WINDOWS_ROOT));
    const again = planOf(first, SHIPPED, WINDOWS_ROOT);
    assert.deepEqual(again.counts, { inserted: 0, unchanged: 3, changed: 0, removed: 0 });
  });

  it('never takes a handler whose command only looks like teamrig for its own', () => {
    const lookalike = { type: 'command', command: 'node /opt/other/dist/cli/main.js serve', timeout: 5 };
    const plan = planOf({ hooks: { Stop: [{ hooks: [lookalike] }] } }, source({}));
    assert.deepEqual(plan.counts, { inserted: 0, unchanged: 0, changed: 0, removed: 0 });
    assert.equal(plan.file, undefined);
  });

  it('refuses a file holding a top-level key Codex refuses', () => {
    assert.match(problemOf({ hooks: {}, extra: true }, SHIPPED), /holds the key extra/u);
  });

  it('refuses a file whose event entry is no list of groups', () => {
    assert.match(problemOf({ hooks: { Stop: {} } }, SHIPPED), /Stop entry is not a list/u);
    assert.match(problemOf({ hooks: { Stop: [{ matcher: 'x' }] } }, SHIPPED), /Stop group 1 has no list of hooks/u);
  });

  it('refuses a plugin hooks file it cannot rewrite', () => {
    assert.match(problemOf({}, { hooks: { Stop: [{ hooks: [{ type: 'prompt' }] }] } }), /cannot be written for Codex/u);
  });
});

describe('codexUserHooks.file', () => {
  it('reads ~/.codex/hooks.json when CODEX_HOME is unset or blank', () => {
    assert.equal(codexUserHooks({}, 'linux').file('/srv/people/ada'), '/srv/people/ada/.codex/hooks.json');
    assert.equal(codexUserHooks({ CODEX_HOME: '  ' }, 'linux').file('/srv/people/ada'), '/srv/people/ada/.codex/hooks.json');
  });

  it('reads hooks.json in CODEX_HOME when it is set', () => {
    assert.equal(codexUserHooks({ CODEX_HOME: '/srv/codex' }, 'linux').file('/srv/people/ada'), '/srv/codex/hooks.json');
  });

  it('tells the person to trust the hooks again after every update', () => {
    assert.ok(port.afterWrite.some((line) => /\/hooks/u.test(line) && /every update/u.test(line)));
  });
});

describe('codexUserHooks.configLines', () => {
  function onlyLine(env: Readonly<Record<string, string>> = {}) {
    const lines = codexUserHooks(env, 'linux').configLines;
    assert.equal(lines.length, 1);
    const [line] = lines;
    assert.ok(line);
    return line;
  }

  it('edits config.toml beside the hooks file: in CODEX_HOME when set, else ~/.codex', () => {
    assert.equal(onlyLine().file('/srv/people/ada'), '/srv/people/ada/.codex/config.toml');
    assert.equal(onlyLine({ CODEX_HOME: '/srv/codex' }).file('/srv/people/ada'), '/srv/codex/config.toml');
  });

  it('names the setting as the person reads it in the file', () => {
    assert.equal(onlyLine().setting, '[features] unified_exec_tty = false, and the same in each [profiles.<name>.features] that turns it on');
  });

  it('turns interactive shells off in a profile that turns them on, beside the root key, and adds none to a profile', () => {
    const answer = onlyLine().merge('[profiles.fast.features]\nunified_exec_tty = true\n[profiles.slow]\nmodel = "m"\n');
    assert.ok(answer.ok && answer.text !== undefined);
    assert.equal(answer.text, '[profiles.fast.features]\nunified_exec_tty = false\n[profiles.slow]\nmodel = "m"\n\n[features]\nunified_exec_tty = false\n');
    assert.deepEqual(onlyLine().merge(answer.text), { ok: true, text: undefined });
    const profileOnly = onlyLine().merge('[features]\nunified_exec_tty = false\n[profiles.fast.features]\nunified_exec_tty = true\n');
    assert.deepEqual(profileOnly, { ok: true, text: '[features]\nunified_exec_tty = false\n[profiles.fast.features]\nunified_exec_tty = false\n' });
  });

  it('refuses a profile inline table that may hold the key, naming the Codex config', () => {
    const answer = onlyLine().merge('[features]\nunified_exec_tty = false\n[profiles.a]\nfeatures = { unified_exec_tty = true }\n');
    assert.equal(answer.ok, false);
    assert.match(answer.ok ? '' : answer.problem, /^the Codex config is not one teamrig can set unified_exec_tty in: it sets profiles\.a\.features as an inline table/u);
  });

  it("turns interactive shells off, keeping the person's other lines, and finds nothing to change on a second run", () => {
    const first = onlyLine().merge('model = "o4"\n');
    assert.ok(first.ok && first.text !== undefined);
    assert.match(first.text, /^model = "o4"$/mu);
    assert.match(first.text, /^\[features\]\nunified_exec_tty = false$/mu);
    assert.deepEqual(onlyLine().merge(first.text), { ok: true, text: undefined });
  });

  it('writes the setting into an empty or missing file', () => {
    const answer = onlyLine().merge('');
    assert.ok(answer.ok && answer.text !== undefined);
    assert.match(answer.text, /^\[features\]\nunified_exec_tty = false$/mu);
  });

  it('refuses a features inline table, naming the Codex config and the key to set by hand', () => {
    const answer = onlyLine().merge('features = { other = true }\n');
    assert.equal(answer.ok, false);
    assert.match(answer.ok ? '' : answer.problem, /^the Codex config is not one teamrig can set unified_exec_tty in: .*inline table/u);
  });
});
