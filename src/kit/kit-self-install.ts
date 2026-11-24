import { isAbsolute, join, relative } from 'node:path';
import type { LockTimings, Mutex } from '../core/lock.ts';
import { CLIENT_MANIFEST } from '../exec/client-integrity.ts';
import { installKitVersion, kitVersionsFolder, type KitInstallOutcome, type KitPorts } from './kit-versions.ts';

/**
 * The kit home's install lock as a session start takes it: never waited on, since a start that finds it held leaves
 * the copy to the start holding it. Its TTL outlasts a slow copy of a release (about 6 MB) to a busy disk.
 */
export const KIT_INSTALL_LOCK: LockTimings = { ttlMs: 300_000, pollMs: 50, waitMs: 0 };

/** The install lock: `<kit home>/versions.lock`, beside the folder it guards. */
export function kitInstallLockPath(kitHome: string): string {
  return join(kitHome, 'versions.lock');
}

/** The running client's own copy into the kit home: the folder it runs from and the version it is. */
export interface KitSelfInstall extends KitPorts {
  /** The running client's root, the plugin folder holding its `dist/`; never a path an argument or the environment gave. */
  readonly clientRoot: string;
  readonly version: string;
  readonly lock: Mutex;
}

/** What a session start's self-copy did: skipped, or the install's outcome. */
export type KitSelfInstallOutcome =
  /** The client runs from a kit version already, or from a source tree with no integrity list (a dev run). */
  | { readonly kind: 'skipped'; readonly why: 'runs-from-kit' | 'no-integrity-list' }
  | KitInstallOutcome;

/** Whether `path` is `folder` or inside it. */
function isWithin(folder: string, path: string): boolean {
  const rel = relative(folder, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * At a session start, copies the running client into `versions/<version>` and names it current (kit-versions.ts), so
 * a host whose hooks run from the kit home runs this version next. It copies only the client's own root, which is why
 * it runs with no exec guard. A client running from the kit's versions folder copies nothing: it is installed already.
 */
export async function installRunningKit(install: KitSelfInstall): Promise<KitSelfInstallOutcome> {
  const { files, kitHome, clientRoot } = install;
  if (isWithin(kitVersionsFolder(kitHome), clientRoot)) {
    return { kind: 'skipped', why: 'runs-from-kit' };
  }
  if ((await files.read(join(clientRoot, CLIENT_MANIFEST))) === undefined) {
    return { kind: 'skipped', why: 'no-integrity-list' };
  }
  return installKitVersion({ ...install, from: clientRoot, source: { kind: 'claude-code-plugin' } });
}

/** The session-start note of a pinned install, which names the pin each time so it is never silent; else undefined. */
export function kitSelfInstallNote(outcome: KitSelfInstallOutcome): string | undefined {
  return outcome.kind === 'pinned'
    ? `teamrig pinned at ${outcome.pinned}; ${outcome.version} is installed; \`teamrig use --latest\` moves to it.`
    : undefined;
}

/** The restore log's line for a self-copy that changed or refused something; undefined for one that did nothing. */
export function kitSelfInstallLogLine(outcome: KitSelfInstallOutcome): string | undefined {
  switch (outcome.kind) {
    case 'installed':
      return `kit: ${outcome.previous ?? 'none'} -> ${outcome.version}: current`;
    case 'pinned':
      return `kit: ${outcome.version} kept; current pinned at ${outcome.pinned}`;
    case 'refused':
      return `kit: refused: ${outcome.why}`;
    case 'skipped':
    case 'current':
    case 'older':
    case 'busy':
      return undefined;
  }
}
