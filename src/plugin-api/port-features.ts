import type { HostFeatureId } from '../features/registry.ts';
import { isUnsupported, type HostPorts } from '../ports/host/index.ts';
import type { Manifest } from './support.ts';

/** The rows one host port serves: never none, so a port no row names does not compile. */
type ServedRows = readonly [HostFeatureId, ...HostFeatureId[]];

/**
 * The parity rows each host port serves, a row beside every port its feature runs through. A built port tells that
 * its rows are built, so a manifest calling all of them unsupported misleads whoever reads the parity page: a built
 * row is `supported` with no proofs, built but not proven live, until a live run proves it. A row may need more than
 * one port; a port's rows include every feature its contract in the conformance kit names.
 */
export const HOST_PORT_FEATURES = {
  hooks: [
    'rules.session-start',
    'inbox.prompt-line',
    'context.compact-hold',
    'hooks.pretool-guard',
    'hooks.file-guard',
    'hooks.exec-review',
    'hooks.readonly-allow',
    'hooks.ask-refuse',
    'hooks.permission-refuse',
    'hooks.output-redact',
    'hooks.prompt-secret',
    'hooks.tool-failure',
    'sessions.turn-end',
    'sessions.effort-writeback',
    'sessions.identity',
    'wake.api-retry',
    'errors.kinds',
    'os.windows-hooks',
  ],
  toolCall: ['hooks.pretool-guard', 'hooks.file-guard', 'hooks.exec-review', 'hooks.readonly-allow', 'hooks.ask-refuse', 'hooks.output-redact', 'hooks.tool-failure'],
  transcripts: ['tabs.title-status', 'sessions.turn-end', 'sessions.carry', 'context.size', 'budget.transcripts', 'budget.model-share', 'budget.helper-weight'],
  usage: ['budget.usage', 'context.size', 'budget.week-reading', 'budget.five-hour', 'budget.pools', 'budget.windows'],
  statusLine: ['budget.status-line'],
  paths: ['rules.instruction-files', 'rules.rules-folder', 'rules.memory', 'rules.start-size', 'skills.team', 'helpers.agent-types', 'hooks.readonly-allow'],
  secrets: ['hooks.file-guard', 'hooks.output-redact', 'hooks.prompt-secret'],
  permissions: ['permissions.deny-lines', 'permissions.auto-mode-routes'],
  plugin: ['plugin.install-update', 'plugin.cli-on-path'],
  launcher: ['sessions.open', 'sessions.identity', 'sessions.resume', 'sessions.process', 'os.windows-sessions'],
  models: ['sessions.open'],
  steps: ['plugin.install-update', 'sessions.in-tab', 'sessions.resume'],
  userHooks: ['plugin.hooks-file', 'plugin.hook-trust'],
  pluginSkills: ['skills.plugin'],
} as const satisfies Readonly<Record<keyof HostPorts, ServedRows>>;

export function isHostPortName(value: string): value is keyof HostPorts {
  return Object.hasOwn(HOST_PORT_FEATURES, value);
}

const PORT_NAMES: readonly (keyof HostPorts)[] = Object.keys(HOST_PORT_FEATURES).filter(isHostPortName);

/**
 * What a host's manifest says falsely of the ports it builds: a built port whose every row says unsupported. Rows
 * are judged per port, not one by one, since a built port need not serve each of its rows.
 */
export function portFeatureProblems(manifest: Manifest<'host'>, ports: HostPorts): readonly string[] {
  return PORT_NAMES.flatMap((name) => {
    const rows = HOST_PORT_FEATURES[name];
    const told = isUnsupported(ports[name]) || rows.some((id) => manifest[id].kind !== 'unsupported');
    return told ? [] : [`its ${name} port is built, yet every row it serves says unsupported (${rows.join(', ')}): a built row is supported with no proofs until a live run proves it`];
  });
}
