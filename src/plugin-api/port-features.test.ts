import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACTS, yesStatusLine } from '../conformance/index.ts';
import { HOST_PORT_NAMES, unsupported, type HostPorts } from '../ports/host/index.ts';
import { manifestOf, SUPPORTED, UNSUPPORTED } from '../testing/manifests.ts';
import { featuresOf } from '../features/registry.ts';
import { HOST_PORT_FEATURES, isHostPortName, portFeatureProblems } from './port-features.ts';
import { isManifest, type Manifest } from './support.ts';

/** The host port a kit contract binds, where the kit spells the name its own way. */
const KIT_PORT: Readonly<Record<string, string>> = { transcript: 'transcripts', 'status-line': 'statusLine' };

const NO_PORTS: HostPorts = {
  hooks: unsupported('no hooks'),
  toolCall: unsupported('no tool calls'),
  transcripts: unsupported('no transcripts'),
  usage: unsupported('no usage'),
  pluginSkills: unsupported('no skills folder'),
  statusLine: unsupported('no status line'),
  paths: unsupported('no paths'),
  secrets: unsupported('no secret files'),
  permissions: unsupported('no permissions'),
  plugin: unsupported('no plugin store'),
  launcher: unsupported('no launcher'),
  models: unsupported('no models'),
  steps: unsupported('no steps'),
  userHooks: unsupported('no hooks file'),
};

const WITH_STATUS_LINE: HostPorts = { ...NO_PORTS, statusLine: yesStatusLine().port };

function hostManifest(over: Readonly<Record<string, unknown>> = {}): Manifest<'host'> {
  const data = manifestOf('host', UNSUPPORTED, over);
  assert.ok(isManifest('host', data));
  return data;
}

describe('HOST_PORT_FEATURES', () => {
  it('names every host port, and only rows of the registry', () => {
    assert.deepEqual(Object.keys(HOST_PORT_FEATURES), HOST_PORT_NAMES);
    const ids = new Set<string>(featuresOf('host').map((row) => row.id));
    assert.deepEqual(
      Object.values(HOST_PORT_FEATURES)
        .flat()
        .filter((id) => !ids.has(id)),
      [],
    );
  });

  it("holds every feature a host contract of the conformance kit names under that contract's port", () => {
    const hostContracts = CONTRACTS.filter((contract) => contract.side === 'host');
    assert.ok(hostContracts.length > 0);
    for (const contract of hostContracts) {
      const name = KIT_PORT[contract.port] ?? contract.port;
      assert.ok(isHostPortName(name), `the kit's ${contract.port} contract binds no host port`);
      const served = new Set<string>(HOST_PORT_FEATURES[name]);
      assert.deepEqual(
        contract.features.filter((feature) => !served.has(feature)),
        [],
        name,
      );
    }
  });
});

describe('portFeatureProblems', () => {
  it('finds a built port whose every row says unsupported', () => {
    assert.deepEqual(portFeatureProblems(hostManifest(), WITH_STATUS_LINE), [
      'its statusLine port is built, yet every row it serves says unsupported (budget.status-line): a built row is supported with no proofs until a live run proves it',
    ]);
  });

  it('takes one row of a built port that says supported, with no proofs, as enough', () => {
    assert.deepEqual(portFeatureProblems(hostManifest({ 'budget.status-line': SUPPORTED }), WITH_STATUS_LINE), []);
  });

  it('takes a partial row as enough', () => {
    const partial = { kind: 'partial', missing: 'no live run yet', notice: 'built, not proven live', proofs: [] };
    assert.deepEqual(portFeatureProblems(hostManifest({ 'budget.status-line': partial }), WITH_STATUS_LINE), []);
  });

  it('says nothing of a port the host does not build, whatever its rows say', () => {
    assert.deepEqual(portFeatureProblems(hostManifest(), NO_PORTS), []);
    assert.deepEqual(portFeatureProblems(hostManifest({ 'sessions.open': SUPPORTED }), NO_PORTS), []);
  });
});
