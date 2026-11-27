/**
 * The version of the surface an adapter is built against, as semver. Its major rises when a change breaks an
 * adapter, and the loader refuses one built for another major, so an old adapter never half-runs. Its minor rises
 * with an optional field a declaration may use (0.2.0: `steps` and `terms`; 0.3.0: a tracker's `search` and a
 * thread's `title`; 0.4.0: a usage meter's `transcriptWeekReading`; 0.5.0: a session launcher's
 * `restrictionReading`; 0.6.0: a host's paths may answer undefined for a place the host does not have; 0.7.0: a
 * tracker's `reopen`; 0.8.0: a hook bridge's `unreadable`), which a teamrig of the same major but an older minor
 * leaves unread.
 */
export const API_VERSION = '0.8.0';

const SEMVER = /^(\d+)\.\d+\.\d+$/;

function majorOf(version: string): string | undefined {
  return SEMVER.exec(version)?.[1];
}

/** Whether `text` is a plain semver version (`1.4.0`). */
export function isApiVersion(text: string): boolean {
  return SEMVER.test(text);
}

/** Why an adapter built for `declared` cannot load into a teamrig whose plugin API is `current`; undefined when it can. */
export function apiVersionNotice(declared: string, current: string): string | undefined {
  const built = majorOf(declared);
  if (built === undefined) {
    return `its apiVersion ${JSON.stringify(declared)} is not a version like ${current}`;
  }
  return built === majorOf(current) ? undefined : `it is built for plugin API ${declared} and this teamrig has ${current}: their major versions differ`;
}
