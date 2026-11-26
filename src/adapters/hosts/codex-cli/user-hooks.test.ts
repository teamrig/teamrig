import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HookLauncher, JsonRecord, UserHooksPlan } from '../../../plugin-api/index.ts';
import { codexUserHooks } from './user-hooks.ts';

const ROOT = '/opt/teamrig/plugin';
const KIT_LAUNCHER = '/srv/ada/.teamrig/bin/teamrig.mjs';
const WINDOWS_KIT_LAUNCHER = 'D:\\People\\ada b\\.teamrig\\bin\\teamrig.mjs';

/** The launcher as the kit gives it (src/kit/hook-launcher.ts), at `path`. */
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

function planOf(current: JsonRecord, from: unknown, launcherPath = KIT_LAUNCHER): UserHooksPlan {
  const answer = port.merge(current, from, ROOT, launcherAt(launcherPath));
  assert.equal(answer.ok, true, answer.ok ? '' : answer.problem);
  return answer.ok ? answer.value : { file: undefined, counts: { inserted: 0, unchanged: 0, changed: 0, removed: 0 }, skipped: [] };
}

function problemOf(current: JsonRecord, from: unknown): string {
  const answer = port.merge(current, from, ROOT, launcherAt(KIT_LAUNCHER));
  assert.equal(answer.ok, false);
  return answer.ok ? '' : answer.problem;
}

function written(plan: UserHooksPlan): JsonRecord {
  assert.ok(plan.file, 'the merge leaves the file as it was');
  return plan.file;
}

/** A handler as releases before the kit launcher wrote it: `node <plugin folder>/dist/cli/<script> hook <name>`. */
function folderHandler(folder: string, script: string, name: string): JsonRecord {
  return { type: 'command', command: `node ${folder}/dist/cli/${script} hook ${name} --host codex-cli`, timeout: 15 };
}

const PERSONS_HANDLER = { type: 'command', command: 'echo started', timeout: 5 };
const SHIPPED = source({ SessionStart: ['session-start', 'tab-status'], Stop: ['stop'] });

describe('codexUserHooks.merge', () => {
  it("puts teamrig's handlers into an empty file, running the kit launcher, and counts each as inserted", () => {
    const plan = planOf({}, SHIPPED);
    assert.deepEqual(plan.counts, { inserted: 3, unchanged: 0, changed: 0, removed: 0 });
    assert.deepEqual(plan.skipped, []);
    const file = written(plan);
    assert.deepEqual(Object.keys(file), ['hooks']);
    const text = JSON.stringify(file);
    assert.match(text, /node \/srv\/ada\/\.teamrig\/bin\/teamrig\.mjs --launcher-entry main --launcher-event SessionStart hook session-start --host codex-cli/u);
    assert.doesNotMatch(text, /plugin|dist\/cli/u);
  });

  it('refuses a run that names no kit launcher, so it never writes a plugin folder', () => {
    const answer = port.merge({}, SHIPPED, ROOT);
    assert.deepEqual(answer, { ok: false, problem: "teamrig's Codex hooks run from the kit launcher, and this run names none" });
  });

  it('says the kit launcher runs its lines, so setup hooks checks the kit home first', () => {
    assert.ok(port.kitLauncher);
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

  it('counts a handler an older release wrote below a plugin folder as changed, and rewrites it to the launcher', () => {
    const old: JsonRecord = {
      hooks: {
        SessionStart: [{ hooks: [folderHandler('/opt/cache/teamrig/0.500.0', 'main.js', 'session-start'), folderHandler('/opt/cache/teamrig/0.500.0', 'main.js', 'tab-status')] }],
        Stop: [{ hooks: [PERSONS_HANDLER, folderHandler('/opt/cache/teamrig/0.500.0', 'main.js', 'stop')] }],
      },
    };
    const plan = planOf(old, SHIPPED);
    assert.deepEqual(plan.counts, { inserted: 0, unchanged: 0, changed: 3, removed: 0 });
    const file = written(plan);
    const text = JSON.stringify(file);
    assert.doesNotMatch(text, /0\.500\.0|dist\/cli/u);
    const hooks = file['hooks'];
    assert.ok(hooks !== null && typeof hooks === 'object');
    const stop: unknown = Reflect.get(hooks, 'Stop');
    assert.ok(Array.isArray(stop));
    assert.deepEqual(stop[0], { hooks: [PERSONS_HANDLER] });
  });

  it('counts a handler an older release wrote for another entry script as removed, not changed', () => {
    const old: JsonRecord = { hooks: { Stop: [{ hooks: [folderHandler('/opt/cache/teamrig/0.500.0', 'guard-main.js', 'stop')] }] } };
    const plan = planOf(old, source({ Stop: ['stop'] }));
    assert.deepEqual(plan.counts, { inserted: 1, unchanged: 0, changed: 0, removed: 1 });
  });

  it('counts a handler written for another kit launcher path as changed and rewrites it', () => {
    const old = written(planOf({}, SHIPPED, '/srv/old-home/.teamrig/bin/teamrig.mjs'));
    const plan = planOf(old, SHIPPED);
    assert.deepEqual(plan.counts, { inserted: 0, unchanged: 0, changed: 3, removed: 0 });
    assert.doesNotMatch(JSON.stringify(written(plan)), /old-home/u);
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

  it('recognises its handlers under a quoted Windows kit launcher path', () => {
    const first = written(planOf({}, SHIPPED, WINDOWS_KIT_LAUNCHER));
    const again = planOf(first, SHIPPED, WINDOWS_KIT_LAUNCHER);
    assert.deepEqual(again.counts, { inserted: 0, unchanged: 3, changed: 0, removed: 0 });
  });

  it('never takes a handler whose command only looks like teamrig for its own', () => {
    const lookalikes = [
      { type: 'command', command: 'node /opt/other/dist/cli/main.js serve', timeout: 5 },
      { type: 'command', command: 'node /opt/other/bin/teamrig.mjs --launcher-entry other --launcher-event Stop hook stop', timeout: 5 },
      { type: 'command', command: 'node /opt/other/bin/teamrig.mjs hook stop', timeout: 5 },
    ];
    const plan = planOf({ hooks: { Stop: [{ hooks: lookalikes }] } }, source({}));
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

/** What `kit uninstall` would write to `current`, the remove's answer held to be a plan. */
function removalOf(current: JsonRecord): UserHooksPlan {
  assert.ok(port.kitLauncher, 'the Codex port runs the kit launcher');
  const answer = port.kitLauncher.remove(current, launcherAt(KIT_LAUNCHER));
  assert.equal(answer.ok, true, answer.ok ? '' : answer.problem);
  return answer.ok ? answer.value : { file: undefined, counts: { inserted: 0, unchanged: 0, changed: 0, removed: 0 }, skipped: [] };
}

describe('codexUserHooks.kitLauncher.remove', () => {
  it("takes out every teamrig handler a merge wrote, keeps the person's own, and drops an event left empty", () => {
    const installed = written(planOf({ description: 'mine', hooks: { SessionStart: [{ hooks: [PERSONS_HANDLER] }] } }, SHIPPED));
    const plan = removalOf(installed);
    assert.deepEqual(plan.counts, { inserted: 0, unchanged: 0, changed: 0, removed: 3 });
    assert.deepEqual(plan.skipped, []);
    assert.deepEqual(written(plan), { description: 'mine', hooks: { SessionStart: [{ hooks: [PERSONS_HANDLER] }] } });
  });

  it('takes out the lines an older release wrote with its plugin folder too', () => {
    const current: JsonRecord = { hooks: { Stop: [{ hooks: [PERSONS_HANDLER, folderHandler('/opt/cache/teamrig/0.500.0', 'main.js', 'stop')] }] } };
    const plan = removalOf(current);
    assert.deepEqual(plan.counts, { inserted: 0, unchanged: 0, changed: 0, removed: 1 });
    assert.deepEqual(written(plan), { hooks: { Stop: [{ hooks: [PERSONS_HANDLER] }] } });
  });

  it('leaves a file holding none of teamrig as it is, an empty list the person wrote included', () => {
    const plan = removalOf({ hooks: { SessionStart: [{ hooks: [PERSONS_HANDLER] }], Stop: [] } });
    assert.equal(plan.file, undefined);
    assert.deepEqual(plan.counts, { inserted: 0, unchanged: 0, changed: 0, removed: 0 });
  });

  it('refuses a file Codex itself would refuse, naming what is wrong', () => {
    assert.ok(port.kitLauncher);
    const answer = port.kitLauncher.remove({ hooks: { Stop: 'none' } }, launcherAt(KIT_LAUNCHER));
    assert.deepEqual(answer, { ok: false, problem: 'the Codex hooks file is not one teamrig can take its handlers out of: its Stop entry is not a list' });
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

  it('tells the person to trust the hooks once, and that an update leaves the trust as it is', () => {
    assert.ok(port.afterWrite.some((line) => /\/hooks/u.test(line)));
    assert.ok(port.afterWrite.some((line) => /kit launcher/u.test(line) && /update leaves them/u.test(line)));
    assert.ok(!port.afterWrite.some((line) => /every update/u.test(line)));
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

describe("Codex CLI's <name>.config.toml profiles (Codex 0.171)", () => {
  function onlySet(env: Readonly<Record<string, string>> = {}) {
    const sets = codexUserHooks(env, 'linux').configFileSets ?? [];
    assert.equal(sets.length, 1);
    const [set] = sets;
    assert.ok(set);
    return set;
  }

  it('looks for them beside config.toml: in CODEX_HOME when set, else ~/.codex', () => {
    assert.equal(onlySet().folder('/srv/people/ada'), '/srv/people/ada/.codex');
    assert.equal(onlySet({ CODEX_HOME: '/srv/codex' }).folder('/srv/people/ada'), '/srv/codex');
  });

  it('holds each <name>.config.toml, never config.toml itself or another file', () => {
    assert.deepEqual(['fast.config.toml', 'a.b.config.toml', 'config.toml', '.config.toml', 'hooks.json', 'fast.toml', 'fast.config.toml.bak'].filter((name) => onlySet().holds(name)), ['fast.config.toml', 'a.b.config.toml']);
  });

  it('turns tty shells off where the profile turns them on, and adds the key to none', () => {
    assert.deepEqual(onlySet().merge('[features]\nunified_exec_tty = true\n'), { ok: true, text: '[features]\nunified_exec_tty = false\n' });
    assert.deepEqual(onlySet().merge('model = "m"\n'), { ok: true, text: undefined });
  });

  it('refuses an inline features table, naming the Codex profile', () => {
    const answer = onlySet().merge('features = { unified_exec_tty = true }\n');
    assert.match(answer.ok ? '' : answer.problem, /^the Codex profile is not one teamrig can set unified_exec_tty in: .*inline table/u);
  });
});
