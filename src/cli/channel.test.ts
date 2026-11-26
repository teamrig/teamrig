import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { HostSource } from '../composition/host-ports.ts';
import { bareHost } from '../testing/bare-host.ts';
import { CliHarness, TEAM, USER_HOME, type CliResult } from '../testing/cli-harness.ts';
import { FakeHooks } from '../testing/fake-hooks.ts';
import { SHIPPED_HOST, UNKNOWN_PLACES_HOST } from '../testing/host.ts';
import { MemoryPathProbe } from '../testing/memory-files.ts';
import { EXIT } from './runtime.ts';

const PLUGINS = join(USER_HOME, '.claude', 'plugins');
const SETTINGS = join(USER_HOME, '.claude', 'settings.json');
const CLAUDE = '/bin/claude';
const ADD_PREVIEW = `${CLAUDE} plugin marketplace add acme/teamrig#preview`;
const ADD_STABLE = `${CLAUDE} plugin marketplace add acme/teamrig`;
const REINSTALL = `${CLAUDE} plugin update teamrig@kit`;

type Source = Readonly<Record<string, string>>;

const github = (ref?: string): Source => ({ source: 'github', repo: 'acme/teamrig', ...(ref === undefined ? {} : { ref }) });

/** A machine with teamrig installed for every project from the marketplace `kit`, cloned from `source`. */
async function installed(source: Source, settings?: unknown): Promise<CliHarness> {
  const kit = new CliHarness(TEAM);
  const plugins = {
    'teamrig@kit': [{ scope: 'user', installPath: '/cache/kit/teamrig/0.505.0', version: '0.505.0' }],
    'helper@tools': [{ scope: 'user', installPath: '/cache/tools/helper/1.0.0', version: '1.0.0' }],
  };
  await kit.files.write(join(PLUGINS, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }));
  await kit.files.write(join(PLUGINS, 'known_marketplaces.json'), JSON.stringify({ kit: { source, installLocation: '/clones/kit' } }));
  if (settings !== undefined) {
    await kit.files.write(SETTINGS, JSON.stringify(settings));
  }
  await kit.files.write(CLAUDE, '');
  return kit;
}

function run(kit: CliHarness, argv: readonly string[], hooks = new FakeHooks(), host: HostSource = SHIPPED_HOST): Promise<CliResult> {
  return kit.run(['channel', ...argv], { hooks, platform: 'linux', env: { PATH: '/bin' }, probe: new MemoryPathProbe(kit.files), host });
}

async function settingsRead(kit: CliHarness): Promise<unknown> {
  return JSON.parse((await kit.files.read(SETTINGS)) ?? 'null');
}

describe('runCli: channel', () => {
  it('names the stable channel for a marketplace on its default branch, and preview for one on preview', async () => {
    const onStable = await run(await installed(github()), []);
    assert.equal(onStable.code, EXIT.ok, onStable.stderr.join('\n'));
    assert.deepEqual(onStable.stdout, ['teamrig 0.505.0 follows the stable channel (marketplace kit)']);
    const onPreview = await run(await installed(github('preview')), []);
    assert.deepEqual(onPreview.stdout, ['teamrig 0.505.0 follows the preview channel (marketplace kit)']);
  });

  it('refuses a marketplace read from a local folder, which follows no branch', async () => {
    const result = await run(await installed({ source: 'directory', path: '/work/teamrig' }), []);
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout.concat(result.stderr).join('\n'), /not a git clone/);
  });

  it('refuses a machine with no teamrig install, and a host that keeps no plugin store', async () => {
    const kit = new CliHarness(TEAM);
    assert.equal((await run(kit, [])).code, EXIT.refused);
    const bare = await run(await installed(github()), [], new FakeHooks(), bareHost);
    assert.equal(bare.code, EXIT.refused);
  });

  it('refuses on a host whose plugins folder teamrig does not know, saying so (T5582)', async () => {
    const result = await run(await installed(github()), [], new FakeHooks(), UNKNOWN_PLACES_HOST);
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout.concat(result.stderr).join('\n'), /does not know where this host keeps its installed plugins/);
  });
});

describe('runCli: channel preview and channel stable', () => {
  it('shows the change without --yes and writes or runs nothing', async () => {
    const kit = await installed(github(), { extraKnownMarketplaces: { kit: { source: github() } } });
    const hooks = new FakeHooks();
    const result = await run(kit, ['preview'], hooks);
    assert.equal(result.code, EXIT.ok, result.stderr.join('\n'));
    assert.deepEqual(result.stdout, [
      'PREVIEW nothing written (add --yes to write): the stable channel -> the preview channel',
      `  CHANGE ${SETTINGS}: the marketplace kit's own entry follows preview`,
      `  RUN claude plugin marketplace add acme/teamrig#preview`,
      `  RUN claude plugin update teamrig@kit`,
    ]);
    assert.deepEqual(hooks.ran, []);
    assert.deepEqual(await settingsRead(kit), { extraKnownMarketplaces: { kit: { source: github() } } });
  });

  it('with --yes sets the ref in the settings first, then adds the marketplace at it and reinstalls teamrig', async () => {
    const kit = await installed(github(), { model: 'opus', extraKnownMarketplaces: { kit: { source: github() } } });
    const hooks = new FakeHooks();
    const result = await run(kit, ['preview', '--yes'], hooks);
    assert.equal(result.code, EXIT.ok, result.stderr.join('\n'));
    assert.match(result.stdout[0] ?? '', /^DONE teamrig follows the preview channel; a new session runs it; the old settings file is at /);
    assert.deepEqual(hooks.commands, [ADD_PREVIEW, REINSTALL]);
    assert.deepEqual(await settingsRead(kit), { model: 'opus', extraKnownMarketplaces: { kit: { source: github('preview') } } });
  });

  it('moves back to stable, dropping the ref, and leaves settings that name no marketplace alone', async () => {
    const kit = await installed(github('preview'), { model: 'opus' });
    const hooks = new FakeHooks();
    const result = await run(kit, ['stable', '--yes'], hooks);
    assert.equal(result.code, EXIT.ok, result.stderr.join('\n'));
    assert.deepEqual(hooks.commands, [ADD_STABLE, REINSTALL]);
    assert.deepEqual(await settingsRead(kit), { model: 'opus' });
  });

  it('changes nothing when the install already follows the channel', async () => {
    const kit = await installed(github('preview'), { extraKnownMarketplaces: { kit: { source: github('preview') } } });
    const hooks = new FakeHooks();
    const result = await run(kit, ['preview', '--yes'], hooks);
    assert.deepEqual(result.stdout, ['UNCHANGED teamrig already follows the preview channel']);
    assert.deepEqual(hooks.ran, []);
  });

  it('names the step that failed and where the old settings are kept', async () => {
    const kit = await installed(github(), { extraKnownMarketplaces: { kit: { source: github() } } });
    const hooks = new FakeHooks().answer(ADD_PREVIEW.split(' '), { lines: ['repository not found'], end: 1 });
    const result = await run(kit, ['preview', '--yes'], hooks);
    assert.equal(result.code, EXIT.failed);
    assert.match(result.stderr.join('\n'), /^FAILED claude plugin marketplace add acme\/teamrig#preview: repository not found; the old settings file is at /);
    assert.deepEqual(hooks.commands, [ADD_PREVIEW]);
  });

  it('refuses before writing anything when the host program is not on PATH', async () => {
    const kit = await installed(github(), { extraKnownMarketplaces: { kit: { source: github() } } });
    await kit.files.remove(CLAUDE);
    const hooks = new FakeHooks();
    const result = await run(kit, ['preview', '--yes'], hooks);
    assert.equal(result.code, EXIT.refused);
    assert.deepEqual(hooks.ran, []);
    assert.deepEqual(await settingsRead(kit), { extraKnownMarketplaces: { kit: { source: github() } } });
  });
});
