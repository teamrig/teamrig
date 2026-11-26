import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { loadShippedHosts, type HostSource } from '../../composition/host-ports.ts';
import { isRecord } from '../../core/guards.ts';
import { settingsWriteRefusal } from '../../core/settings-writers.ts';
import { kitInstallLockPath } from '../../kit/kit-self-install.ts';
import { KIT_LOCK_BUSY, kitCurrentPath, kitCurrentRecordPath, kitVersionFolder, kitVersionsFolder } from '../../kit/kit-versions.ts';
import { isUnsupported } from '../../ports/host/index.ts';
import { cliLauncherPath } from '../../restore/cli-launcher.ts';
import { hostDeps } from '../../testing/adapter-deps.ts';
import { CliHarness, type RunOptions } from '../../testing/cli-harness.ts';
import { holdFileLock } from '../../testing/held-file-lock.ts';
import { seedKitHome } from '../../testing/kit-home.ts';
import { MemoryKitTree } from '../../testing/memory-kit-tree.ts';
import { EXIT } from '../runtime.ts';

const PLUGIN_HOOKS_TEXT = readFileSync(new URL('../../../plugins/teamrig/hooks/hooks.json', import.meta.url), 'utf8');
/** The quiet world's CLI runs from /opt/teamrig/dist/cli/main.js, so its plugin root is /opt/teamrig. */
const PLUGIN_HOOKS = '/opt/teamrig/hooks/hooks.json';
const CODEX_HOME = '/srv/codex';
const CODEX_HOOKS = '/srv/codex/hooks.json';
/** An absolute kit home on every OS, as the launcher path a Codex line names must be. */
const KIT_HOME = resolve('/', 'kit-home');
const VERSION = '0.510.0';
const PERSONS_HANDLER = { type: 'command', command: 'echo done', timeout: 5 };
const PERSONS = { hooks: { Stop: [{ hooks: [PERSONS_HANDLER] }] } };
const TEAM_FILE = join(KIT_HOME, 'teams', 'alpha', 'config.json');
const PREVIEW = 'PREVIEW nothing removed (add --yes to remove)';
const STAYS = `NOTE ${join(KIT_HOME, 'teams')}, the backups and the install clone stay; a host's teamrig plugin installs teamrig again at its next session start, so remove the plugin first`;

const shipped = Object.values(await loadShippedHosts(hostDeps().run)).map((entry) => entry.ports);
const codex: HostSource | undefined = shipped.find((source) => {
  const { userHooks } = source(hostDeps());
  return !isUnsupported(userHooks) && userHooks.host === 'codex';
});

/** The commands of every handler in a hooks file's text. */
function handlerCommands(text: string | undefined): readonly string[] {
  const file: unknown = JSON.parse(text ?? '{}');
  if (!isRecord(file) || !isRecord(file['hooks'])) return [];
  return Object.values(file['hooks']).flatMap((groups) =>
    Array.isArray(groups)
      ? groups.flatMap((group) => (isRecord(group) && Array.isArray(group['hooks']) ? group['hooks'].flatMap((handler) => (isRecord(handler) && typeof handler['command'] === 'string' ? [handler['command']] : [])) : []))
      : [],
  );
}

describe('teamrig kit uninstall', () => {
  let kit: CliHarness;
  let tree: MemoryKitTree;

  function options(env: Readonly<Record<string, string>> = {}): RunOptions {
    assert.ok(codex, 'no shipped host keeps a hooks file of the person');
    return {
      shippedHosts: { 'codex-cli': { ports: codex, sessionVariables: { marks: [], identity: [] } } },
      env: { CODEX_HOME, TEAMRIG_HOME: KIT_HOME, ...env },
      kitTree: tree,
    };
  }

  /** The kit home after a session start and the person's Codex hooks file after `setup hooks --host codex --yes`. */
  beforeEach(async () => {
    kit = new CliHarness();
    tree = new MemoryKitTree(kit.files);
    await kit.files.write(PLUGIN_HOOKS, PLUGIN_HOOKS_TEXT);
    await seedKitHome(kit.files, KIT_HOME, VERSION);
    await kit.files.write(TEAM_FILE, '{}\n');
    await kit.files.write(CODEX_HOOKS, `${JSON.stringify(PERSONS)}\n`);
    const setup = await kit.run(['setup', 'hooks', '--host', 'codex', '--yes'], options());
    assert.equal(setup.code, EXIT.ok, setup.stdout.join('\n'));
  });

  /** What a run must leave as it found: the hooks file, the kit home's records, launcher and version. */
  function installed(): readonly (string | undefined)[] {
    return [kitCurrentPath(KIT_HOME), kitCurrentRecordPath(KIT_HOME), cliLauncherPath(KIT_HOME)].map((path) => kit.files.get(path));
  }

  it('counts what it would take out and removes nothing without --yes', async () => {
    const hooks = kit.files.get(CODEX_HOOKS);
    const before = installed();
    const result = await kit.run(['kit', 'uninstall'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.match(result.stdout[0] ?? '', new RegExp(`^${PREVIEW.replace(/[()]/gu, '\\$&')} /srv/codex/hooks\\.json: removed [1-9]\\d*$`, 'u'));
    assert.equal(
      result.stdout[1],
      `${PREVIEW} ${KIT_HOME}: versions 1: ${VERSION}; files 3: ${cliLauncherPath(KIT_HOME)}, ${kitCurrentPath(KIT_HOME)}, ${kitCurrentRecordPath(KIT_HOME)}`,
    );
    assert.equal(result.stdout[2], STAYS);
    assert.deepEqual([kit.files.get(CODEX_HOOKS), installed()], [hooks, before]);
  });

  it("takes teamrig's lines out first, keeping the person's own, then removes the kit home's install and keeps the teams", async () => {
    const result = await kit.run(['kit', 'uninstall', '--yes'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.match(result.stdout[0] ?? '', /^WROTE \/srv\/codex\/hooks\.json: removed [1-9]\d*; the old file is at .*codex-hooks.*\.json$/u);
    assert.equal(
      result.stdout[1],
      `REMOVED 4: ${cliLauncherPath(KIT_HOME)}, ${kitCurrentPath(KIT_HOME)}, ${kitCurrentRecordPath(KIT_HOME)}, ${kitVersionsFolder(KIT_HOME)}`,
    );
    assert.deepEqual(handlerCommands(kit.files.get(CODEX_HOOKS)), ['echo done']);
    assert.deepEqual(installed(), [undefined, undefined, undefined]);
    assert.deepEqual(await kit.files.list(kitVersionsFolder(KIT_HOME)), []);
    assert.equal(kit.files.get(TEAM_FILE), '{}\n');
  });

  it('removes only the kit home where the person keeps no hooks file of a launcher host', async () => {
    await kit.files.remove(CODEX_HOOKS);
    const result = await kit.run(['kit', 'uninstall', '--yes'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.match(result.stdout[0] ?? '', /^REMOVED 4: /u);
    assert.equal(kit.files.get(CODEX_HOOKS), undefined);
  });

  it('says a hooks file holding none of teamrig stays as it is', async () => {
    await kit.files.write(CODEX_HOOKS, `${JSON.stringify(PERSONS)}\n`);
    const result = await kit.run(['kit', 'uninstall'], options());
    assert.equal(result.stdout[0], "UNCHANGED /srv/codex/hooks.json: it holds none of teamrig's handlers");
  });

  it('refuses a hooks file it cannot edit before anything is removed', async () => {
    await kit.files.write(CODEX_HOOKS, JSON.stringify({ hooks: { Stop: 'none' } }));
    const before = installed();
    const result = await kit.run(['kit', 'uninstall', '--yes'], options());
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout[0] ?? '', /^REFUSED teamrig kit uninstall: \/srv\/codex\/hooks\.json: the Codex hooks file is not one teamrig can take its handlers out of: .*; nothing removed$/u);
    assert.deepEqual(installed(), before);
  });

  it('refuses its write where Claude Code runs it', async () => {
    const before = installed();
    const result = await kit.run(['kit', 'uninstall', '--yes'], options({ CLAUDECODE: '1' }));
    assert.deepEqual(result.stdout, [`REFUSED ${settingsWriteRefusal('kit uninstall', 'CLAUDECODE')}`]);
    assert.deepEqual(installed(), before);
  });

  it('keeps the kit home while another process holds the install lock past the wait, its lines already out', async () => {
    await holdFileLock(kit, kitInstallLockPath(KIT_HOME));
    const before = installed();
    const result = await kit.run(['kit', 'uninstall', '--yes'], options());
    assert.equal(result.code, EXIT.refused);
    assert.equal(result.stdout.at(-1), `REFUSED teamrig kit uninstall: ${KIT_LOCK_BUSY}; the hooks files above no longer run it: run this again to remove the kit home`);
    assert.deepEqual(handlerCommands(kit.files.get(CODEX_HOOKS)), ['echo done']);
    assert.deepEqual(installed(), before);
  });

  it('fails naming the versions folder a running process holds, having removed the rest', async () => {
    tree.heldFolders.add(kitVersionsFolder(KIT_HOME));
    const result = await kit.run(['kit', 'uninstall', '--yes'], options());
    assert.equal(result.code, EXIT.failed);
    assert.equal(
      result.stdout.at(-1),
      `NOTE left in place, a running process holds a file in it: ${kitVersionsFolder(KIT_HOME)}; run it again once that process ends`,
    );
    assert.deepEqual(await kit.files.list(kitVersionsFolder(KIT_HOME)), [VERSION]);
    assert.notEqual(await kit.files.list(kitVersionFolder(KIT_HOME, VERSION)), []);
    assert.deepEqual(installed(), [undefined, undefined, undefined]);
  });
});
