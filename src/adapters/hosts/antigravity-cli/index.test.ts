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
    assert.deepEqual(Object.keys(ports), ['hooks', 'toolCall', 'transcripts', 'usage', 'statusLine', 'paths', 'secrets', 'permissions', 'plugin', 'launcher', 'models', 'steps', 'userHooks']);
    assert.equal(isUnsupported(ports.hooks), false);
    assert.equal(isUnsupported(ports.toolCall), false);
    assert.equal(isUnsupported(ports.paths), false);
    assert.deepEqual(!isUnsupported(ports.secrets) && ports.secrets.secretFiles(), []);
    assert.equal(ports.statusLine, statusLine);
    assert.equal(isUnsupported(ports.transcripts), true);
  });
});
