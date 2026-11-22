import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { API_VERSION, apiVersionNotice, featuresOf, hostAdapterProblems, hostDeclarationProblems, isUnsupported } from '../../../plugin-api/index.ts';
import { hostDeps } from '../../../testing/adapter-deps.ts';
import { declaration } from './declaration.ts';
import adapter from './index.ts';

describe('the Codex CLI adapter', () => {
  it('declares a host built for the plugin API of this teamrig', () => {
    assert.deepEqual(hostDeclarationProblems(declaration), []);
    assert.equal(declaration.id, 'codex-cli');
    assert.equal(declaration.name, 'Codex CLI');
    assert.equal(apiVersionNotice(declaration.apiVersion, API_VERSION), undefined);
  });

  it("tells an agent's run by the conversation id Codex sets for its shell tool", () => {
    assert.deepEqual(declaration.sessionVariables, { marks: ['CODEX_THREAD_ID'], identity: [] });
  });

  it('claims no host feature before a live run proves it', () => {
    const claimed = featuresOf('host')
      .filter((row) => declaration.manifest[row.id].kind !== 'unsupported')
      .map((row) => row.id);
    assert.deepEqual(claimed, []);
  });

  it("enters through defineHost with that declaration, and names every host port unsupported but its hooks, tools, secret files and the person's hooks file", () => {
    assert.equal(adapter.declaration, declaration);
    assert.deepEqual(hostAdapterProblems(adapter), []);
    const ports = adapter.create(hostDeps());
    assert.deepEqual(Object.keys(ports), ['hooks', 'toolCall', 'transcripts', 'usage', 'statusLine', 'paths', 'secrets', 'permissions', 'plugin', 'launcher', 'models', 'steps', 'userHooks']);
    assert.deepEqual(
      Object.entries(ports)
        .filter(([, port]) => !isUnsupported(port))
        .map(([name]) => name),
      ['hooks', 'toolCall', 'secrets', 'userHooks'],
    );
  });

  it("finds the person's hooks file from the environment and platform it is handed", () => {
    const { userHooks } = adapter.create(hostDeps({ env: { CODEX_HOME: 'D:\\agents\\codex' }, platform: 'win32' }));
    assert.ok(!isUnsupported(userHooks));
    assert.equal(userHooks.file('D:\\home\\ada'), 'D:\\agents\\codex\\hooks.json');
  });

  it("reads a hook's tool call through its own tools on the platform it is handed", () => {
    const { hooks } = adapter.create(hostDeps({ platform: 'win32' }));
    assert.ok(!isUnsupported(hooks));
    const event = hooks.parse(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'Get-ChildItem' } }));
    assert.equal(event?.call?.kind, 'shell');
    assert.equal(event?.call?.kind === 'shell' ? event.call.dialect : undefined, 'powershell');
  });

  it("names Codex's secret files from the environment and platform it is handed", () => {
    const { secrets } = adapter.create(hostDeps({ env: { CODEX_HOME: 'C:\\agents\\codex' }, platform: 'win32' }));
    assert.ok(!isUnsupported(secrets));
    const files = secrets.secretFiles();
    assert.ok(files.includes('~/.codex/auth.json'));
    assert.ok(files.includes('C:/agents/codex/auth.json'));
  });
});
