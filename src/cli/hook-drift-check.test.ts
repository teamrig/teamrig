import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { loadShippedHosts, type HostSource } from '../composition/host-ports.ts';
import { isUnsupported } from '../ports/host/index.ts';
import { hostDeps } from '../testing/adapter-deps.ts';
import { CliHarness, type RunOptions } from '../testing/cli-harness.ts';
import { seedKitHome } from '../testing/kit-home.ts';
import { hookDriftWarnings } from './hook-drift-check.ts';
import { EXIT } from './runtime.ts';

const PLUGIN_HOOKS_TEXT = readFileSync(new URL('../../plugins/teamrig/hooks/hooks.json', import.meta.url), 'utf8');
const PLUGIN_HOOKS = '/opt/teamrig/hooks/hooks.json';
const CODEX_HOME = '/srv/codex';
const CODEX_HOOKS = '/srv/codex/hooks.json';
const CODEX_CONFIG = '/srv/codex/config.toml';
const KIT_HOME = resolve('/', 'kit-home');
const LISTED = ['claude-code', 'codex-cli'];
/** The team CliHarness runs in: its team home is the kit's teams/app folder. */
const TEAM_NAME = 'app';

const shipped = Object.values(await loadShippedHosts(hostDeps().run)).map((entry) => entry.ports);
const codex: HostSource | undefined = shipped.find((source) => {
  const { userHooks } = source(hostDeps());
  return !isUnsupported(userHooks) && userHooks.host === 'codex';
});

function options(over: RunOptions = {}): RunOptions {
  assert.ok(codex, 'no shipped host keeps a hooks file of the person');
  return { shippedHosts: { 'codex-cli': { ports: codex, sessionVariables: { marks: [], identity: [] } } }, env: { CODEX_HOME, TEAMRIG_HOME: KIT_HOME }, ...over };
}

/** A machine with the plugin installed and Codex's hooks and config set up by `setup hooks --yes`. */
async function healed(): Promise<CliHarness> {
  const kit = new CliHarness();
  await kit.files.write(PLUGIN_HOOKS, PLUGIN_HOOKS_TEXT);
  await seedKitHome(kit.files, KIT_HOME, '0.510.0');
  const setup = await kit.run(['setup', 'hooks', '--host', 'codex', '--yes'], options());
  assert.equal(setup.code, EXIT.ok, setup.stdout.join('\n'));
  return kit;
}

describe('hookDriftWarnings (HOOK-DRIFT)', () => {
  it('finds nothing right after setup hooks wrote the files', async () => {
    const kit = await healed();
    assert.deepEqual(await hookDriftWarnings(kit.runtime(options()), LISTED, TEAM_NAME), []);
  });

  it("warns when a teamrig handler was taken out of the person's hooks file, naming the heal", async () => {
    const kit = await healed();
    await kit.files.write(CODEX_HOOKS, JSON.stringify({ hooks: {} }));
    const warnings = await hookDriftWarnings(kit.runtime(options()), LISTED, TEAM_NAME);
    assert.deepEqual(warnings.map((warning) => warning.key), [`hook-drift codex-cli ${CODEX_HOOKS}`]);
    assert.match(warnings[0]?.text ?? '', /^HOOK-DRIFT \/srv\/codex\/hooks\.json differs from this install's hooks \([1-9]\d* missing, 0 changed, 0 stale\), .*teamrig setup hooks --host codex --yes/u);
    assert.equal(warnings[0]?.source, 'the hook drift check [hosts]');
  });

  it('warns when the hooks file is gone from a host folder that is still there', async () => {
    const kit = await healed();
    await kit.files.remove(CODEX_HOOKS);
    const warnings = await hookDriftWarnings(kit.runtime(options()), LISTED, TEAM_NAME);
    assert.deepEqual(warnings.map((warning) => warning.text.split(',')[0]), [`HOOK-DRIFT ${CODEX_HOOKS} is missing`]);
  });

  it('warns when the config lost the setting the guards need', async () => {
    const kit = await healed();
    await kit.files.write(CODEX_CONFIG, 'model = "o4"\n');
    const warnings = await hookDriftWarnings(kit.runtime(options()), LISTED, TEAM_NAME);
    assert.deepEqual(warnings.map((warning) => warning.key), [`hook-drift codex-cli ${CODEX_CONFIG}`]);
    assert.match(warnings[0]?.text ?? '', /^HOOK-DRIFT \/srv\/codex\/config\.toml lacks \[features\] unified_exec_tty = false/u);
  });

  it('warns, without throwing, on a hooks file that is not JSON', async () => {
    const kit = await healed();
    await kit.files.write(CODEX_HOOKS, '{ not json');
    const warnings = await hookDriftWarnings(kit.runtime(options()), LISTED, TEAM_NAME);
    assert.match(warnings[0]?.text ?? '', /^HOOK-DRIFT \/srv\/codex\/hooks\.json cannot be read \(.*is not valid JSON/u);
  });

  it('skips a host whose hooks folder is not on this machine', async () => {
    const kit = new CliHarness();
    await kit.files.write(PLUGIN_HOOKS, PLUGIN_HOOKS_TEXT);
    assert.deepEqual(await hookDriftWarnings(kit.runtime(options()), LISTED, TEAM_NAME), []);
  });

  it('skips a host the team does not list', async () => {
    const kit = await healed();
    await kit.files.remove(CODEX_HOOKS);
    assert.deepEqual(await hookDriftWarnings(kit.runtime(options()), ['claude-code'], TEAM_NAME), []);
  });

  it('skips a run from a source checkout, which has no installed plugin to plan from', async () => {
    const kit = await healed();
    await kit.files.remove(CODEX_HOOKS);
    const source = options({ self: { node: '/usr/bin/node', script: '/work/teamrig/src/cli/main.ts', execArgv: [] } });
    assert.deepEqual(await hookDriftWarnings(kit.runtime(source), LISTED, TEAM_NAME), []);
  });
});
