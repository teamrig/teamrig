import type { InstallMark, MarkedPath } from '../kit/install-mark.ts';

/** An install mark that only records each lift and set, with the paths it was given, and fails one when told to. */
export class RecordingMark implements InstallMark {
  failLift = false;
  failSet = false;

  /** Shared with the caller, so a spec can put the mark's calls in order with its own steps. */
  readonly log: string[];

  constructor(log: string[] = []) {
    this.log = log;
  }

  async lift(paths: readonly MarkedPath[]): Promise<void> {
    this.log.push(`lift ${paths.map((marked) => marked.path).join(' ')}`);
    if (this.failLift) {
      throw new Error('lift refused');
    }
  }

  async set(paths: readonly MarkedPath[]): Promise<void> {
    this.log.push(`set ${paths.map((marked) => marked.path).join(' ')}`);
    if (this.failSet) {
      throw new Error('set refused');
    }
  }
}
