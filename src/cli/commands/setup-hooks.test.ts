import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { loadShippedHosts, type HostSource } from '../../composition/host-ports.ts';
import { isRecord } from '../../core/guards.ts';
import { isUnsupported } from '../../ports/host/index.ts';
import { hostDeps } from '../../testing/adapter-deps.ts';
import { CliHarness, type RunOptions } from '../../testing/cli-harness.ts';
import { seedKitHome } from '../../testing/kit-home.ts';
import { cliLauncherPath } from '../../restore/cli-launcher.ts';
import { kitCurrentPath } from '../../kit/kit-versions.ts';
import { EXIT } from '../runtime.ts';

const PLUGIN_HOOKS_TEXT = readFileSync(new URL('../../../plugins/teamrig/hooks/hooks.json', import.meta.url), 'utf8');
/** The quiet world's CLI runs from /opt/teamrig/dist/cli/main.js, so its plugin root is /opt/teamrig. */
const PLUGIN_HOOKS = '/opt/teamrig/hooks/hooks.json';
const CODEX_HOME = '/srv/codex';
const CODEX_HOOKS = '/srv/codex/hooks.json';
const CODEX_CONFIG = '/srv/codex/config.toml';
/** Codex 0.171 profiles, `<name>.config.toml` beside config.toml (T5361). */
const CODEX_PROFILE = '/srv/codex/fast.config.toml';
const QUIET_PROFILE = '/srv/codex/quiet.config.toml';
const PROFILE_SETTING = '[features] unified_exec_tty = false where the profile sets it';
/** An absolute kit home on every OS, as the launcher path a Codex line names must be. */
const KIT_HOME = resolve('/', 'kit-home');
const KIT_VERSION = '0.510.0';
const PERSONS: unknown = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done', timeout: 5 }] }] } };

const shipped = Object.values(await loadShippedHosts(hostDeps().run)).map((entry) => entry.ports);
const codex: HostSource | undefined = shipped.find((source) => {
  const { userHooks } = source(hostDeps());
  return !isUnsupported(userHooks) && userHooks.host === 'codex';
});

function options(over: RunOptions = {}): RunOptions {
  assert.ok(codex, 'no shipped host keeps a hooks file of the person');
  return { shippedHosts: { 'codex-cli': { ports: codex, sessionVariables: { marks: [], identity: [] } } }, env: { CODEX_HOME, TEAMRIG_HOME: KIT_HOME }, ...over };
}

async function kitWithPlugin(): Promise<CliHarness> {
  const kit = new CliHarness();
  await kit.files.write(PLUGIN_HOOKS, PLUGIN_HOOKS_TEXT);
  await seedKitHome(kit.files, KIT_HOME, KIT_VERSION);
  return kit;
}

function handlerCommands(text: string | undefined): readonly string[] {
  const file: unknown = JSON.parse(text ?? '{}');
  if (!isRecord(file) || !isRecord(file['hooks'])) return [];
  return Object.values(file['hooks']).flatMap((groups) =>
    Array.isArray(groups)
      ? groups.flatMap((group) => (isRecord(group) && Array.isArray(group['hooks']) ? group['hooks'].flatMap((handler) => (isRecord(handler) && typeof handler['command'] === 'string' ? [handler['command']] : [])) : []))
      : [],
  );
}

describe('teamrig setup hooks --host codex', () => {
  it('previews the counts without --yes and writes nothing', async () => {
    const kit = await kitWithPlugin();
    const result = await kit.run(['setup', 'hooks', '--host', 'codex'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.match(result.stdout[0] ?? '', /^PREVIEW nothing written \(add --yes to write\) \/srv\/codex\/hooks\.json: inserted [1-9]\d*, unchanged 0, changed 0, removed 0$/u);
    assert.ok(result.stdout.some((line) => /NOTE .*\/hooks/u.test(line)));
    assert.equal(kit.files.get(CODEX_HOOKS), undefined);
  });

  it("writes teamrig's handlers beside the person's, keeps the old file, and finds nothing to change on a second run", async () => {
    const kit = await kitWithPlugin();
    await kit.files.write(CODEX_HOOKS, JSON.stringify(PERSONS));
    const result = await kit.run(['setup', 'hooks', '--host', 'codex', '--yes'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.match(result.stdout[0] ?? '', /^WROTE \/srv\/codex\/hooks\.json: inserted [1-9]\d*, .*; the old file is at .*codex-hooks\.json$/u);
    assert.ok(result.stdout.some((line) => /NOTE .*kit launcher.*update leaves them/u.test(line)));
    const commands = handlerCommands(kit.files.get(CODEX_HOOKS));
    assert.ok(commands.includes('echo done'));
    assert.ok(commands.some((command) => command.startsWith('node ') && command.includes('teamrig.mjs') && command.includes(' --launcher-entry main --launcher-event ')));

    const again = await kit.run(['setup', 'hooks', '--host', 'codex'], options());
    assert.match(again.stdout[0] ?? '', /^UNCHANGED \/srv\/codex\/hooks\.json: teamrig's hooks are already in it \(inserted 0, unchanged [1-9]\d*, changed 0, removed 0\)$/u);
    assert.equal(again.stdout.some((line) => line.includes('NOTE')), false);
  });

  it('names what Codex cannot run rather than dropping it silently', async () => {
    const kit = await kitWithPlugin();
    const result = await kit.run(['setup', 'hooks', '--host', 'codex'], options());
    assert.ok(result.stdout.some((line) => /^ {2}SKIPPED .*: (event Codex lacks|rewake Codex lacks)$/u.test(line)));
  });

  it('refuses a host name no shipped host answers to, naming those that do', async () => {
    const kit = await kitWithPlugin();
    const result = await kit.run(['setup', 'hooks', '--host', 'other'], options());
    assert.equal(result.code, EXIT.refused);
    assert.deepEqual(result.stdout, ['REFUSED no host named other keeps a hooks file of yours teamrig writes into (the hosts that keep one: codex)']);
  });

  it('refuses a person hooks file it cannot merge into, writing nothing', async () => {
    const kit = await kitWithPlugin();
    await kit.files.write(CODEX_HOOKS, '{"hooks": {}, "extra": 1}');
    const result = await kit.run(['setup', 'hooks', '--host', 'codex', '--yes'], options());
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout[0] ?? '', /holds the key extra.*; nothing written$/u);
    assert.equal(kit.files.get(CODEX_HOOKS), '{"hooks": {}, "extra": 1}');
  });

  it("refuses when the plugin's hooks file is missing", async () => {
    const kit = new CliHarness();
    const result = await kit.run(['setup', 'hooks', '--host', 'codex'], options());
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout[0] ?? '', /hooks file \/opt\/teamrig\/hooks\/hooks\.json is missing/u);
  });

  it("refuses a run from anything but the plugin's built entry script", async () => {
    const kit = await kitWithPlugin();
    const result = await kit.run(['setup', 'hooks', '--host', 'codex'], options({ self: { node: '/usr/bin/node', script: '/work/teamrig/src/cli/main.ts', execArgv: [] } }));
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout[0] ?? '', /runs from the installed plugin's dist\/cli\/main\.js, not \/work\/teamrig\/src\/cli\/main\.ts/u);
  });

  it("previews the config.toml setting without --yes and writes no config", async () => {
    const kit = await kitWithPlugin();
    const result = await kit.run(['setup', 'hooks', '--host', 'codex'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.equal(result.stdout[1], 'PREVIEW nothing written (add --yes to write) /srv/codex/config.toml: sets [features] unified_exec_tty = false, and the same in each [profiles.<name>.features] that turns it on');
    assert.equal(kit.files.get(CODEX_CONFIG), undefined);
  });

  it("writes a new config.toml with --yes, and finds it unchanged on a second run", async () => {
    const kit = await kitWithPlugin();
    const result = await kit.run(['setup', 'hooks', '--host', 'codex', '--yes'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.equal(result.stdout[1], 'WROTE /srv/codex/config.toml: sets [features] unified_exec_tty = false, and the same in each [profiles.<name>.features] that turns it on');
    assert.match(kit.files.get(CODEX_CONFIG) ?? '', /^\[features\]\nunified_exec_tty = false$/mu);

    const again = await kit.run(['setup', 'hooks', '--host', 'codex'], options());
    assert.equal(again.stdout[1], 'UNCHANGED /srv/codex/config.toml: it already sets [features] unified_exec_tty = false, and the same in each [profiles.<name>.features] that turns it on');
  });

  it("keeps the person's config.toml as a backup before setting the key in it", async () => {
    const kit = await kitWithPlugin();
    await kit.files.write(CODEX_CONFIG, 'model = "o4"\n');
    const result = await kit.run(['setup', 'hooks', '--host', 'codex', '--yes'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    const line = result.stdout[1] ?? '';
    assert.match(line, /^WROTE \/srv\/codex\/config\.toml: sets \[features\] unified_exec_tty = false, and the same in each \[profiles\.<name>\.features\] that turns it on; the old file is at .*codex-config\.bak$/u);
    const backup = line.slice(line.indexOf('the old file is at ') + 'the old file is at '.length);
    assert.equal(kit.files.get(backup), 'model = "o4"\n');
    assert.match(kit.files.get(CODEX_CONFIG) ?? '', /^model = "o4"$/mu);
  });

  it('refuses a config.toml it cannot edit before writing the hooks file or the config', async () => {
    const kit = await kitWithPlugin();
    await kit.files.write(CODEX_CONFIG, 'features = { other = true }\n');
    const result = await kit.run(['setup', 'hooks', '--host', 'codex', '--yes'], options());
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout[0] ?? '', /^REFUSED \/srv\/codex\/config\.toml: the Codex config is not one teamrig can set unified_exec_tty in: .*; nothing written$/u);
    assert.equal(kit.files.get(CODEX_HOOKS), undefined);
    assert.equal(kit.files.get(CODEX_CONFIG), 'features = { other = true }\n');
  });

  it("turns tty shells off in each <name>.config.toml profile that turns them on, adds the key to none, and backs each up", async () => {
    const kit = await kitWithPlugin();
    await kit.files.write(CODEX_PROFILE, 'model = "m"\n[features]\nunified_exec_tty = true\n');
    await kit.files.write(QUIET_PROFILE, 'model = "m"\n');
    await kit.files.write('/srv/codex/notes.toml', '[features]\nunified_exec_tty = true\n');
    const preview = await kit.run(['setup', 'hooks', '--host', 'codex'], options());
    assert.ok(preview.stdout.includes(`PREVIEW nothing written (add --yes to write) ${CODEX_PROFILE}: sets ${PROFILE_SETTING}`), preview.stdout.join('\n'));
    assert.ok(preview.stdout.includes(`UNCHANGED ${QUIET_PROFILE}: it already sets ${PROFILE_SETTING}`));
    assert.equal(preview.stdout.some((line) => line.includes('notes.toml')), false);

    const result = await kit.run(['setup', 'hooks', '--host', 'codex', '--yes'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    const line = result.stdout.find((entry) => entry.startsWith(`WROTE ${CODEX_PROFILE}:`)) ?? '';
    assert.match(line, /; the old file is at .*codex-fast\.config\.toml\.bak$/u);
    assert.equal(kit.files.get(line.slice(line.indexOf('the old file is at ') + 'the old file is at '.length)), 'model = "m"\n[features]\nunified_exec_tty = true\n');
    assert.equal(kit.files.get(CODEX_PROFILE), 'model = "m"\n[features]\nunified_exec_tty = false\n');
    assert.equal(kit.files.get(QUIET_PROFILE), 'model = "m"\n');
    assert.equal(kit.files.get('/srv/codex/notes.toml'), '[features]\nunified_exec_tty = true\n');
  });

  it('refuses a profile it cannot edit before writing anything', async () => {
    const kit = await kitWithPlugin();
    await kit.files.write(CODEX_PROFILE, 'features = { unified_exec_tty = true }\n');
    const result = await kit.run(['setup', 'hooks', '--host', 'codex', '--yes'], options());
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout[0] ?? '', /^REFUSED \/srv\/codex\/fast\.config\.toml: the Codex profile is not one teamrig can set unified_exec_tty in: .*inline table.*; nothing written$/u);
    assert.equal(kit.files.get(CODEX_HOOKS), undefined);
    assert.equal(kit.files.get(CODEX_CONFIG), undefined);
  });

  it('leaves a profile that is a link as it is and says so, since a write would replace the link', async () => {
    const kit = await kitWithPlugin();
    await kit.files.write(CODEX_PROFILE, '[features]\nunified_exec_tty = true\n');
    kit.files.link(CODEX_PROFILE, '/srv/dotfiles/fast.config.toml');
    const result = await kit.run(['setup', 'hooks', '--host', 'codex', '--yes'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.ok(result.stdout.includes(`  SKIPPED ${CODEX_PROFILE}: not a plain file, so teamrig leaves it as it is; set ${PROFILE_SETTING} in it by hand`), result.stdout.join('\n'));
    assert.equal(kit.files.get(CODEX_PROFILE), '[features]\nunified_exec_tty = true\n');
  });

  it('needs --host', async () => {
    const kit = await kitWithPlugin();
    const result = await kit.run(['setup', 'hooks'], options());
    assert.notEqual(result.code, EXIT.ok);
  });

  it('never writes a plugin folder or a version into a Codex line, so a teamrig update leaves the trusted lines as they are', async () => {
    const kit = await kitWithPlugin();
    await kit.run(['setup', 'hooks', '--host', 'codex', '--yes'], options());
    const teamrig = handlerCommands(kit.files.get(CODEX_HOOKS));
    assert.ok(teamrig.length > 0);
    for (const command of teamrig) {
      assert.doesNotMatch(command, /\/opt\/teamrig|dist\/cli|versions|0\.510\.0/u);
    }
  });

  it('rewrites the lines an older release wrote below a plugin folder, counting them as changed', async () => {
    const kit = await kitWithPlugin();
    const old = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node /srv/cache/teamrig/0.500.0/dist/cli/main.js hook stop --host codex-cli', timeout: 15 }] }] } };
    await kit.files.write(CODEX_HOOKS, JSON.stringify(old));
    const result = await kit.run(['setup', 'hooks', '--host', 'codex', '--yes'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.match(result.stdout[0] ?? '', /^WROTE \/srv\/codex\/hooks\.json: inserted \d+, unchanged 0, changed [1-9]\d*, removed 0; /u);
    assert.doesNotMatch(kit.files.get(CODEX_HOOKS) ?? '', /0\.500\.0/u);
  });

  const unready: ReadonlyArray<readonly [string, (kit: CliHarness) => Promise<void>, RegExp]> = [
    ['no teamrig version is current', async (kit) => kit.files.removeAll(kitCurrentPath(KIT_HOME)), /^REFUSED no teamrig version is current in the kit home /u],
    ['the kit launcher is missing', async (kit) => kit.files.removeAll(cliLauncherPath(KIT_HOME)), /^REFUSED the kit launcher .*teamrig\.mjs is missing: /u],
    ["the kit launcher is not the current version's", async (kit) => kit.files.write(cliLauncherPath(KIT_HOME), '// older\n'), /^REFUSED the kit launcher .* is not the one teamrig 0\.510\.0 ships: /u],
  ];
  for (const [what, damage, refusal] of unready) {
    it(`refuses before any write while ${what}, as the launcher would block every guarded call`, async () => {
      const kit = await kitWithPlugin();
      await damage(kit);
      const result = await kit.run(['setup', 'hooks', '--host', 'codex', '--yes'], options());
      assert.equal(result.code, EXIT.refused);
      assert.match(result.stdout[0] ?? '', refusal);
      assert.match(result.stdout[0] ?? '', /start one teamrig session, .*; nothing written$/u);
      assert.equal(kit.files.get(CODEX_HOOKS), undefined);
      assert.equal(kit.files.get(CODEX_CONFIG), undefined);
    });
  }
});

describe('teamrig setup hooks --host antigravity-cli', () => {
  const agySource: HostSource | undefined = shipped.find((source) => {
    const { userHooks } = source(hostDeps());
    return !isUnsupported(userHooks) && userHooks.host === 'antigravity-cli';
  });

  function agyOptions(over: RunOptions = {}): RunOptions {
    assert.ok(agySource, 'antigravity-cli keeps a user hooks file');
    return {
      userHome: '/srv/ada',
      shippedHosts: { 'antigravity-cli': { ports: agySource, sessionVariables: { marks: [], identity: [] } } },
      ...over,
    };
  }

  const AGY_HOOKS = '/srv/ada/.gemini/config/hooks.json';

  it('previews the counts without --yes and writes nothing', async () => {
    const kit = await kitWithPlugin();
    const result = await kit.run(['setup', 'hooks', '--host', 'antigravity-cli'], agyOptions());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.match(result.stdout[0] ?? '', /^PREVIEW nothing written \(add --yes to write\) \/srv\/ada\/\.gemini\/config\/hooks\.json: inserted [1-9]\d*, unchanged 0, changed 0, removed 0$/u);
    assert.equal(kit.files.get(AGY_HOOKS), undefined);
  });

  it('needs no kit home, as its lines name the plugin folder and not the kit launcher', async () => {
    const kit = new CliHarness();
    await kit.files.write(PLUGIN_HOOKS, PLUGIN_HOOKS_TEXT);
    const result = await kit.run(['setup', 'hooks', '--host', 'antigravity-cli'], agyOptions());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
  });

  it("writes the teamrig group beside the person's groups, keeps a backup, and prints UNCHANGED on a re-run", async () => {
    const kit = await kitWithPlugin();
    await kit.files.write(AGY_HOOKS, JSON.stringify({ custom: { Stop: [{ type: 'command', command: 'echo mine', timeout: 5 }] } }));
    const first = await kit.run(['setup', 'hooks', '--host', 'antigravity-cli', '--yes'], agyOptions());
    assert.equal(first.code, EXIT.ok, first.stdout.join('\n'));
    assert.match(first.stdout[0] ?? '', /^WROTE \/srv\/ada\/\.gemini\/config\/hooks\.json: inserted [1-9]\d*, .*; the old file is at .*antigravity-cli-hooks\.json$/u);
    const written: unknown = JSON.parse(kit.files.get(AGY_HOOKS) ?? '{}');
    assert.ok(isRecord(written));
    assert.deepEqual(written['custom'], { Stop: [{ type: 'command', command: 'echo mine', timeout: 5 }] });
    assert.ok(isRecord(written['teamrig']));

    const second = await kit.run(['setup', 'hooks', '--host', 'antigravity-cli', '--yes'], agyOptions());
    assert.equal(second.code, EXIT.ok, second.stdout.join('\n'));
    assert.match(second.stdout[0] ?? '', /^UNCHANGED \/srv\/ada\/\.gemini\/config\/hooks\.json: teamrig's hooks are already in it \(inserted 0, unchanged [1-9]\d*, changed 0, removed 0\)$/u);
  });
});
