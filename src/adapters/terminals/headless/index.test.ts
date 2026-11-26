import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { API_VERSION, apiVersionNotice, featuresOf, terminalAdapterProblems, terminalDeclarationProblems } from '../../../plugin-api/index.ts';
import { terminalDeps } from '../../../testing/adapter-deps.ts';
import { declaration } from './declaration.ts';
import adapter from './index.ts';

describe('the headless adapter', () => {
  it('declares a terminal built for the plugin API of this teamrig', () => {
    assert.deepEqual(terminalDeclarationProblems(declaration), []);
    assert.equal(declaration.id, 'headless');
    assert.equal(declaration.name, 'headless');
    assert.equal(apiVersionNotice(declaration.apiVersion, API_VERSION), undefined);
  });

  it('opens a pane, and claims nothing else', () => {
    const claimed = featuresOf('terminal')
      .filter((row) => declaration.manifest[row.id].kind !== 'unsupported')
      .map((row) => [row.id, declaration.manifest[row.id].kind]);
    assert.deepEqual(claimed, [['pane.open', 'supported']]);
  });

  it('enters through defineTerminal with that declaration, and builds its terminal port', async () => {
    assert.equal(adapter.declaration, declaration);
    assert.deepEqual(terminalAdapterProblems(adapter), []);
    const port = adapter.create(terminalDeps()).terminal;
    assert.notEqual(port, undefined);
    assert.deepEqual((await port?.capabilities())?.requests, ['open']);
  });
});
