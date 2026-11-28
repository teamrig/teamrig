import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isConnectorDeclaration, type ConnectorDeclaration } from '../plugin-api/index.ts';
import { LEVEL_PRESETS, isLevelPreset, type LevelNames } from '../register/level-names.ts';
import { testConfig } from '../testing/config.ts';
import { UNSUPPORTED, connectorDeclarationData, manifestOf } from '../testing/manifests.ts';
import { readDeclarations } from './loader.ts';
import { connectorLevelNames, teamConnectors, trackerLevelNames } from './team-connectors.ts';

const OWN: LevelNames = {
  goal: { singular: 'Theme', plural: 'Themes' },
  feature: { singular: 'Epic', plural: 'Epics' },
  task: { singular: 'Ticket', plural: 'Tickets' },
  subtask: { singular: 'Step', plural: 'Steps' },
};

/** A tracker-only connector declaration with `over` laid on it. */
function tracker(over: Readonly<Record<string, unknown>>): ConnectorDeclaration {
  const data = connectorDeclarationData({ kinds: ['tracker'], manifest: manifestOf('connector', UNSUPPORTED), ...over });
  assert.ok(isConnectorDeclaration(data), JSON.stringify(over));
  return data;
}

describe('teamConnectors', () => {
  it('names GitHub while the team imports a repository, and each connectors section', () => {
    assert.deepEqual([...teamConnectors(testConfig())], []);
    assert.deepEqual([...teamConnectors(testConfig({ github: { repos: ['owner/name'] }, connectors: { jira: {} } }))], ['github', 'jira']);
  });
});

describe('trackerLevelNames', () => {
  const own = tracker({ id: 'own', levelNames: OWN });
  const plain = tracker({ id: 'plain' });

  it("gives the names of the one tracker in use that declares them, beside any that declares none", () => {
    assert.deepEqual(trackerLevelNames([own, plain], new Set(['own', 'plain'])), OWN);
  });

  it('gives none when no tracker in use declares them, or the one that does is not in use', () => {
    assert.equal(trackerLevelNames([own, plain], new Set(['plain'])), null);
    assert.equal(trackerLevelNames([own], new Set()), null);
  });

  it('gives none when two trackers in use declare names, as neither fits all the work', () => {
    const other = tracker({ id: 'other', levelNames: LEVEL_PRESETS.linear });
    assert.equal(trackerLevelNames([own, other], new Set(['own', 'other'])), null);
  });

  it('reads no names from a connector that is no tracker', () => {
    const codeHost = connectorDeclarationData({ id: 'code', kinds: ['codehost'], manifest: manifestOf('connector', UNSUPPORTED), levelNames: OWN });
    assert.ok(isConnectorDeclaration(codeHost));
    assert.equal(trackerLevelNames([codeHost], new Set(['code'])), null);
  });
});

describe('the level names of the connectors teamrig ships', () => {
  it("equal the levels.names preset of the connector's id, so auto and the preset show the same words", async () => {
    const { connectors } = await readDeclarations();
    const named = connectors.flatMap((load) => (load.kind === 'loaded' && load.value.levelNames !== undefined ? [load.value] : []));
    assert.deepEqual(named.map((declaration) => declaration.id).sort(), ['github', 'jira']);
    for (const declaration of named) {
      assert.ok(isLevelPreset(declaration.id), declaration.id);
      assert.deepEqual(declaration.levelNames, LEVEL_PRESETS[declaration.id], declaration.id);
    }
  });

  it("are what auto reads for a team on GitHub alone, on Jira alone, and on neither", async () => {
    assert.deepEqual(await connectorLevelNames(testConfig({ github: { repos: ['owner/name'] } })), LEVEL_PRESETS.github);
    assert.deepEqual(await connectorLevelNames(testConfig({ connectors: { jira: {} } })), LEVEL_PRESETS.jira);
    assert.equal(await connectorLevelNames(testConfig()), null);
    assert.equal(await connectorLevelNames(testConfig({ github: { repos: ['owner/name'] }, connectors: { jira: {} } })), null);
  });
});
