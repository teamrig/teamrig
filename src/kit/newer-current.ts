import type { Files } from '../core/files.ts';
import { compareVersions, parseVersion } from '../core/release-version.ts';
import { readKitCurrent } from './kit-versions.ts';

/**
 * Whether a long-lived teamrig process is older than the version in use (T5813): `<kit home>/current` names the
 * version `kit install` and `kit use` put in use, and a process started on an older one should end once it sees that.
 */

/** `current` when it is a version newer than `running`; undefined when none is named, either is no version, or it is not newer. */
export function newerVersion(current: string | undefined, running: string): string | undefined {
  const named = current === undefined ? undefined : parseVersion(current);
  const own = parseVersion(running);
  return current !== undefined && named !== undefined && own !== undefined && compareVersions(named, own) > 0 ? current : undefined;
}

/** The version `<kit home>/current` names, or undefined when there is none or its two records disagree. */
export async function currentVersion(files: Pick<Files, 'read'>, kitHome: string): Promise<string | undefined> {
  return (await readKitCurrent(files, kitHome))?.version;
}

/** The version `current` names when it is newer than `running`; undefined when none is named, or it is not newer. */
export async function newerCurrent(files: Pick<Files, 'read'>, kitHome: string, running: string): Promise<string | undefined> {
  return newerVersion(await currentVersion(files, kitHome), running);
}
