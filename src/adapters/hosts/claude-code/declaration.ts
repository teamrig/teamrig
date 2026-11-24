import type { HostDeclaration, Support } from '../../../plugin-api/index.ts';
import { SESSION_VARIABLES } from './session-variables.ts';

/**
 * What teamrig does on Claude Code today: every feature but the two below. A row with no proof yet shows unproved on
 * the parity page until a live run on the operating system it names is recorded.
 */
const SUPPORTED: Support = { kind: 'supported', proofs: [] };

/** The live Windows runs recorded in docs/proofs/claude-code.md: the scan of 2026-11-20 and its re-run of 2026-11-23. */
const SCAN: { readonly toolVersion: string; readonly date: string } = { toolVersion: '2.1.329', date: '2026-11-20' };
const RESCAN: { readonly toolVersion: string; readonly date: string } = { toolVersion: '2.1.330', date: '2026-11-23' };

/**
 * A feature proved on Windows, its record under the feature id's heading in docs/proofs/claude-code.md (a heading's
 * anchor drops the id's dot).
 */
function provedOnWindows(feature: string, run: { readonly toolVersion: string; readonly date: string }): Support {
  return {
    kind: 'supported',
    proofs: [{ os: 'windows', toolVersion: run.toolVersion, date: run.date, evidence: `proofs/claude-code.md#${feature.replaceAll('.', '')}` }],
  };
}

/** Tuning a session's model and effort from the user's own results is designed and not built on any CLI yet. */
const TUNING: Support = { kind: 'unsupported', notice: "tuning from a user's own results is not built yet" };

/**
 * A failed turn's error is read by its Claude Code name, and three kinds have their rule: `server_error` and
 * `overloaded` are sent again with a back-off (src/restore/api-error.ts), and an expired login tells the person and
 * is sent again after a login (src/restore/login.ts). No rule reads a rate-limit hit or a context too long as a kind.
 */
const ERROR_KINDS: Support = {
  kind: 'partial',
  missing: 'a rule of its own for a rate-limit hit and for a context too long',
  notice: 'only overload, server and login errors are sent again; a turn that failed another way waits for the person or the next wake',
  proofs: [],
};

export const declaration: HostDeclaration = {
  apiVersion: '0.2.0',
  id: 'claude-code',
  name: 'Claude Code',
  sessionVariables: SESSION_VARIABLES,
  terms: ['Claude Code', 'CLAUDE.md', '.claude/', '/clear'],
  steps: ['host.rename', 'host.slim-setup', 'host.denial-sources'],
  manifest: {
    'rules.session-start': provedOnWindows('rules.session-start', RESCAN),
    'rules.instruction-files': provedOnWindows('rules.instruction-files', SCAN),
    'rules.rules-folder': SUPPORTED,
    'rules.memory': SUPPORTED,
    'rules.start-size': SUPPORTED,
    'inbox.prompt-line': provedOnWindows('inbox.prompt-line', SCAN),
    'context.compact-hold': SUPPORTED,
    'context.size': provedOnWindows('context.size', SCAN),
    'context.refresh': provedOnWindows('context.refresh', RESCAN),
    'hooks.pretool-guard': provedOnWindows('hooks.pretool-guard', SCAN),
    'hooks.file-guard': provedOnWindows('hooks.file-guard', SCAN),
    'hooks.exec-review': SUPPORTED,
    'hooks.readonly-allow': provedOnWindows('hooks.readonly-allow', SCAN),
    'hooks.ask-refuse': SUPPORTED,
    'hooks.permission-refuse': SUPPORTED,
    'hooks.output-redact': SUPPORTED,
    'hooks.prompt-secret': SUPPORTED,
    'hooks.tool-failure': provedOnWindows('hooks.tool-failure', SCAN),
    'permissions.deny-lines': SUPPORTED,
    'permissions.auto-mode-routes': provedOnWindows('permissions.auto-mode-routes', SCAN),
    'sessions.open': provedOnWindows('sessions.open', SCAN),
    'sessions.resume': provedOnWindows('sessions.resume', SCAN),
    'sessions.identity': provedOnWindows('sessions.identity', SCAN),
    'sessions.wake': provedOnWindows('sessions.wake', SCAN),
    'sessions.turn-end': provedOnWindows('sessions.turn-end', SCAN),
    'sessions.process': SUPPORTED,
    'sessions.in-tab': SUPPORTED,
    'sessions.carry': SUPPORTED,
    'sessions.effort-writeback': SUPPORTED,
    'tabs.title-status': provedOnWindows('tabs.title-status', SCAN),
    'tabs.waiting-state': SUPPORTED,
    'tabs.memory': SUPPORTED,
    'wake.api-retry': SUPPORTED,
    'wake.cost': SUPPORTED,
    'skills.plugin': provedOnWindows('skills.plugin', RESCAN),
    'skills.team': provedOnWindows('skills.team', RESCAN),
    'skills.session-listing': provedOnWindows('skills.session-listing', RESCAN),
    'helpers.start-rules': SUPPORTED,
    'helpers.agent-types': SUPPORTED,
    'plugin.hooks-file': provedOnWindows('plugin.hooks-file', SCAN),
    'plugin.hook-trust': SUPPORTED,
    'plugin.install-update': SUPPORTED,
    'plugin.cli-on-path': provedOnWindows('plugin.cli-on-path', RESCAN),
    'budget.transcripts': SUPPORTED,
    'budget.usage': SUPPORTED,
    'budget.model-share': SUPPORTED,
    'budget.week-reading': SUPPORTED,
    'budget.five-hour': SUPPORTED,
    'budget.status-line': SUPPORTED,
    'budget.helper-weight': SUPPORTED,
    'budget.pools': SUPPORTED,
    'budget.windows': SUPPORTED,
    'budget.tuning': TUNING,
    'errors.kinds': ERROR_KINDS,
    'os.windows-sessions': provedOnWindows('os.windows-sessions', SCAN),
    'os.windows-hooks': provedOnWindows('os.windows-hooks', SCAN),
    'os.linux': SUPPORTED,
  },
};
