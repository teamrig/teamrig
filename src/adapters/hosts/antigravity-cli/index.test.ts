import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { API_VERSION, apiVersionNotice, hostAdapterProblems, hostDeclarationProblems, isUnsupported } from '../../../plugin-api/index.ts';
import { hostDeps } from '../../../testing/adapter-deps.ts';
import { declaration } from './declaration.ts';
import adapter from './index.ts';
import { statusLine } from './status-line.ts';

describe('the Antigravity CLI adapter', () => {
  it('declares a valid host for the plugin API of this teamrig', () => {
    assert.deepEqual(hostDeclarationProblems(declaration), []);
    assert.equal(declaration.id, 'antigravity-cli');
    assert.equal(declaration.name, 'Antigravity CLI');
    assert.equal(apiVersionNotice(declaration.apiVersion, API_VERSION), undefined);
  });

  it('enters through defineHost with filled hooks, toolCall, and paths ports', () => {
    assert.equal(adapter.declaration, declaration);
    assert.deepEqual(hostAdapterProblems(adapter), []);
    const ports = adapter.create(hostDeps());
    assert.deepEqual(Object.keys(ports), ['hooks', 'toolCall', 'transcripts', 'usage', 'statusLine', 'paths', 'secrets', 'permissions', 'plugin', 'launcher', 'models', 'steps', 'userHooks', 'pluginSkills']);
    assert.equal(isUnsupported(ports.hooks), false);
    assert.equal(isUnsupported(ports.toolCall), false);
    assert.equal(isUnsupported(ports.paths), false);
    assert.deepEqual(!isUnsupported(ports.secrets) && ports.secrets.secretFiles(), []);
    assert.equal(ports.statusLine, statusLine);
    assert.equal(isUnsupported(ports.transcripts), true);
  });

  it('sets every declared session mark in both recorded agy 1.5.8 hook and run_command environments', () => {
    // Names-only env vars added by standalone agy 1.5.8 in clean-env live runs (values omitted).
    const sessionStartHookVars = [
      'ANTIGRAVITY_CONVERSATION_ID',
      'PROMPT',
    ];
    const runCommandToolVars = [
      'ANTIGRAVITY_AGENT',
      'ANTIGRAVITY_AGENTAPI_EXE',
      'ANTIGRAVITY_APP_DATA_DIR',
      'ANTIGRAVITY_CONVERSATION_ID',
      'ANTIGRAVITY_CSRF_TOKEN',
      'ANTIGRAVITY_LS_ADDRESS',
      'ANTIGRAVITY_LS_VERSION',
      'ANTIGRAVITY_PROJECT_ID',
      'ANTIGRAVITY_SOURCE_METADATA',
      'ANTIGRAVITY_TRAJECTORY_ID',
    ];
    const marks = declaration.sessionVariables?.marks ?? [];
    assert.ok(marks.length > 0);
    for (const mark of marks) {
      assert.equal(sessionStartHookVars.includes(mark), true, `${mark} missing from recorded SessionStart hook env`);
      assert.equal(runCommandToolVars.includes(mark), true, `${mark} missing from recorded run_command tool env`);
    }
  });
});
