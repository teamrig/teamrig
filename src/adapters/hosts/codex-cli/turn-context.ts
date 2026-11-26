/**
 * The restriction a Codex CLI session runs under, read from the `turn_context` lines of its rollout
 * (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`), which Codex writes as each turn starts.
 *
 * A line is `{"timestamp", "type": "turn_context", "payload": {...}}`. Its payload holds `approval_policy`
 * (`untrusted`, `on-request`, its older name `on-failure`, `never`, or `{"granular": {...}}`), the legacy
 * `sandbox_policy` Codex still writes on every line from its permission profile (tagged `type`: `danger-full-access`,
 * `read-only`, `workspace-write`, each but the first with a boolean `network_access`, or `external-sandbox`, whose
 * `network_access` is `restricted` or `enabled`), and, when one is chosen, `active_permission_profile.id`
 * (docs/design/codex-host-study.md, Guards and permissions). `sandbox_policy` is the field read for the sandbox: the newer
 * `permission_profile` is not on every Codex that writes one.
 *
 * Codex's hook input names only `permission_mode`, `bypassPermissions` under approval `never` and `default` under
 * every other policy: it says nothing of the sandbox, so it is never read as sandbox-off.
 */

import { isRecord, type SandboxKind, type SessionRestriction } from '../../../plugin-api/index.ts';

const APPROVALS: ReadonlySet<string> = new Set(['untrusted', 'on-request', 'on-failure', 'never']);

function parsed(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** The approval policy in Codex's word, `granular` for its table of choices; undefined for one this reader does not know. */
function approvalOf(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return APPROVALS.has(value) ? value : undefined;
  }
  return isRecord(value) && isRecord(value['granular']) ? 'granular' : undefined;
}

/** A boolean `network_access`, which Codex leaves out when it is off. */
function flagOf(value: unknown): boolean | undefined {
  if (value === undefined) {
    return false;
  }
  return typeof value === 'boolean' ? value : undefined;
}

/** An external sandbox's `network_access`, `restricted` (Codex's default) or `enabled`. */
function externalNetworkOf(value: unknown): boolean | undefined {
  if (value === undefined || value === 'restricted') {
    return false;
  }
  return value === 'enabled' ? true : undefined;
}

interface Sandbox {
  readonly sandbox: SandboxKind;
  readonly network: boolean | undefined;
}

/** The sandbox of a `sandbox_policy`; undefined for a type or a network field this reader does not know. */
function sandboxOf(value: unknown): Sandbox | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const network = value['network_access'];
  const of = (sandbox: SandboxKind, reached: boolean | undefined): Sandbox | undefined => (reached === undefined ? undefined : { sandbox, network: reached });
  switch (value['type']) {
    case 'danger-full-access':
      return { sandbox: 'none', network: true };
    case 'read-only':
      return of('read-only', flagOf(network));
    case 'workspace-write':
      return of('workspace-write', flagOf(network));
    case 'external-sandbox':
      return of('external', externalNetworkOf(network));
    default:
      return undefined;
  }
}

function profileOf(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = value['id'];
  return typeof id === 'string' && id.trim() !== '' ? id : undefined;
}

/**
 * One rollout line as the restriction its turn ran under; `unknown` for a `turn_context` of a shape this reader does
 * not know, and undefined for any other line, a damaged one included.
 */
export function restrictionOf(line: string): SessionRestriction | undefined | 'unknown' {
  if (!line.includes('"turn_context"')) {
    return undefined;
  }
  const value = parsed(line);
  if (!isRecord(value) || value['type'] !== 'turn_context') {
    return undefined;
  }
  const payload = value['payload'];
  if (!isRecord(payload)) {
    return 'unknown';
  }
  const approval = approvalOf(payload['approval_policy']);
  const sandbox = sandboxOf(payload['sandbox_policy']);
  if (approval === undefined || sandbox === undefined) {
    return 'unknown';
  }
  return { approval, ...sandbox, profile: profileOf(payload['active_permission_profile']) };
}

/**
 * The restriction of the newest turn a rollout's tail records: its last `turn_context`, the turns being written in
 * order. Undefined when the tail holds none, or its last one is of a shape this reader does not know: an older turn's
 * restriction may no longer hold, so it is never told in its place.
 */
export function newestRestriction(tail: string): SessionRestriction | undefined {
  const lines = tail.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const read = restrictionOf(lines[index] ?? '');
    if (read !== undefined) {
      return read === 'unknown' ? undefined : read;
    }
  }
  return undefined;
}
