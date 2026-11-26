import type { HostDeclaration, Support } from '../../../plugin-api/index.ts';
import { SESSION_VARIABLES } from './session-variables.ts';

/**
 * A row is unsupported on Codex CLI only while no port here serves it. A built row is supported with no proofs, built
 * but not proven live, until a live run on a real Codex is recorded as its proof; one built in part is partial and
 * names what is missing (T5559 parity audit). A built port none of whose rows says so fails portFeatureProblems.
 */
const NOT_BUILT: Support = { kind: 'unsupported', notice: 'not built for Codex CLI yet' };
const BUILT: Support = { kind: 'supported', proofs: [] };

/**
 * A row proved by the live Windows run of 2026-11-24 on Codex CLI 0.171.0-alpha.13, its record under the feature id's
 * heading in docs/proofs/codex-cli.md (a heading's anchor drops the id's dot).
 */
function provedOnWindows(feature: string): Support {
  return {
    kind: 'supported',
    proofs: [{ os: 'windows', toolVersion: '0.171.0-alpha.13', date: '2026-11-24', evidence: `proofs/codex-cli.md#${feature.replaceAll('.', '')}` }],
  };
}

/**
 * A row whose port is built here while another contract of the kit that holds the row binds a port Codex CLI does not
 * build: claiming it would let no case hold the claim, so it stays unsupported and names that port.
 */
function needsPort(port: string): Support {
  return { kind: 'unsupported', notice: `not built for Codex CLI yet: it needs the ${port} port` };
}

function partial(missing: string): Support {
  return { kind: 'partial', missing, notice: `built for Codex CLI in part: ${missing}`, proofs: [] };
}

export const declaration: HostDeclaration = {
  apiVersion: '0.2.0',
  id: 'codex-cli',
  name: 'Codex CLI',
  sessionVariables: SESSION_VARIABLES,
  terms: ['Codex', 'AGENTS.md', '.codex/', 'CODEX_HOME'],
  steps: ['host.hooks-file', 'host.skills-folder'],
  manifest: {
    'rules.session-start': provedOnWindows('rules.session-start'),
    'rules.instruction-files': NOT_BUILT,
    'rules.rules-folder': NOT_BUILT,
    'rules.memory': NOT_BUILT,
    'rules.start-size': partial('the AGENTS.md 32 KiB cap and the skill-listing limit are not modelled'),
    'inbox.prompt-line': provedOnWindows('inbox.prompt-line'),
    'context.compact-hold': partial('the hold never fires: it needs the transcripts port'),
    'context.size': BUILT,
    'context.refresh': partial('no size trigger (context.size) and no in-tab clear'),
    'hooks.pretool-guard': provedOnWindows('hooks.pretool-guard'),
    'hooks.file-guard': provedOnWindows('hooks.file-guard'),
    'hooks.exec-review': partial("the owner's typed in-tab review runs only in Claude Code"),
    'hooks.readonly-allow': partial('a read-only line skips the prompt only when asks are refused'),
    'hooks.ask-refuse': NOT_BUILT,
    'hooks.permission-refuse': BUILT,
    'hooks.output-redact': NOT_BUILT,
    'hooks.prompt-secret': BUILT,
    'hooks.tool-failure': partial('Codex has no tool-failure hook; only the missing-command hint runs'),
    'permissions.deny-lines': NOT_BUILT,
    'permissions.auto-mode-routes': NOT_BUILT,
    'sessions.open': needsPort('models'),
    'sessions.resume': needsPort('steps'),
    'sessions.identity': partial("only the session's id is told, by its mark: no start folder, start word, kind or forced effort"),
    'sessions.wake': NOT_BUILT,
    'sessions.turn-end': needsPort('transcripts'),
    'sessions.process': partial("a background job's session is not read: Codex starts one with no session on its command line"),
    'sessions.in-tab': NOT_BUILT,
    'sessions.carry': NOT_BUILT,
    'sessions.effort-writeback': NOT_BUILT,
    'tabs.title-status': NOT_BUILT,
    'tabs.waiting-state': NOT_BUILT,
    'tabs.memory': partial("the killed-step notice reads only Claude Code's reaper"),
    'wake.api-retry': NOT_BUILT,
    'wake.cost': NOT_BUILT,
    'skills.plugin': partial("teamrig's skills reach Codex only once `teamrig setup skills --host codex --yes` copies them; no install step runs it"),
    'skills.team': NOT_BUILT,
    'skills.session-listing': NOT_BUILT,
    'helpers.start-rules': BUILT,
    'helpers.agent-types': NOT_BUILT,
    'plugin.hooks-file': provedOnWindows('plugin.hooks-file'),
    'plugin.hook-trust': NOT_BUILT,
    'plugin.install-update': NOT_BUILT,
    'plugin.cli-on-path': NOT_BUILT,
    'budget.transcripts': NOT_BUILT,
    'budget.usage': BUILT,
    'budget.model-share': NOT_BUILT,
    'budget.week-reading': NOT_BUILT,
    'budget.five-hour': NOT_BUILT,
    'budget.status-line': NOT_BUILT,
    'budget.helper-weight': NOT_BUILT,
    'budget.pools': NOT_BUILT,
    'budget.windows': NOT_BUILT,
    'budget.tuning': NOT_BUILT,
    'errors.kinds': NOT_BUILT,
    'os.windows-sessions': BUILT,
    'os.windows-hooks': provedOnWindows('os.windows-hooks'),
    'os.linux': BUILT,
  },
};
