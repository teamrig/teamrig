import type { Files } from '../core/files.ts';
import { compareVersions, parseVersion } from '../core/release-version.ts';
import { kitCurrentPath, kitCurrentRecordPath, readKitCurrent } from './kit-versions.ts';

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

/**
 * The version `<kit home>/current` names, for a process that asks again and again (the events follower, T5813): it
 * stamps the two records each time and opens them only when a stamp moved, so a look that finds no install reads
 * no file, as the rest of the follower's look does.
 */
export class CurrentVersionReader {
  private readonly files: Pick<Files, 'read' | 'stamp'>;
  private readonly kitHome: string;
  private held: { readonly stamps: readonly (string | undefined)[]; readonly version: string | undefined } | undefined;

  constructor(files: Pick<Files, 'read' | 'stamp'>, kitHome: string) {
    this.files = files;
    this.kitHome = kitHome;
  }

  /** The version current names now, or undefined when there is none or its two records disagree. */
  async version(): Promise<string | undefined> {
    const stamps = [await this.files.stamp(kitCurrentPath(this.kitHome)), await this.files.stamp(kitCurrentRecordPath(this.kitHome))];
    const held = this.held;
    if (held !== undefined && stamps.every((stamp, index) => stamp === held.stamps[index])) {
      return held.version;
    }
    const version = await currentVersion(this.files, this.kitHome);
    this.held = { stamps, version };
    return version;
  }
}

/** The version `current` names when it is newer than `running`; undefined when none is named, or it is not newer. */
export async function newerCurrent(files: Pick<Files, 'read'>, kitHome: string, running: string): Promise<string | undefined> {
  return newerVersion(await currentVersion(files, kitHome), running);
}
