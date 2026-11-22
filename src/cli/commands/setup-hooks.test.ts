import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { loadShippedHosts, type HostSource } from '../../composition/host-ports.ts';
import { isRecord } from '../../core/guards.ts';
import { isUnsupported } from '../../ports/host/index.ts';
import { hostDeps } from '../../testing/adapter-deps.ts';
import { CliHarness, type RunOptions } from '../../testing/cli-harness.ts';
import { EXIT } from '../runtime.ts';

const PLUGIN_HOOKS_TEXT = readFileSync(new URL('../../../plugins/teamrig/hooks/hooks.json', import.meta.url), 'utf8');
/** The quiet world's CLI runs from /opt/teamrig/dist/cli/main.js, so its plugin root is /opt/teamrig. */
const PLUGIN_HOOKS = '/opt/teamrig/hooks/hooks.json';
const CODEX_HOME = '/srv/codex';
const CODEX_HOOKS = '/srv/codex/hooks.json';
const PERSONS: unknown = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done', timeout: 5 }] }] } };

const shipped = await loadShippedHosts(hostDeps().run);
const codex: HostSource | undefined = shipped.find((source) => !isUnsupported(source(hostDeps()).userHooks));

function options(over: RunOptions = {}): RunOptions {
  assert.ok(codex, 'no shipped host keeps a hooks file of the person');
  return { shippedHosts: [codex], env: { CODEX_HOME }, ...over };
}

async function kitWithPlugin(): Promise<CliHarness> {
  const kit = new CliHarness();
  await kit.files.write(PLUGIN_HOOKS, PLUGIN_HOOKS_TEXT);
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
    assert.ok(result.stdout.some((line) => /NOTE .*every update/u.test(line)));
    const commands = handlerCommands(kit.files.get(CODEX_HOOKS));
    assert.ok(commands.includes('echo done'));
    assert.ok(commands.some((command) => command.startsWith('node /opt/teamrig/dist/cli/')));

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

  it('needs --host', async () => {
    const kit = await kitWithPlugin();
    const result = await kit.run(['setup', 'hooks'], options());
    assert.notEqual(result.code, EXIT.ok);
  });
});
