import type { KitConfig } from '../config/types.ts';
import { LogNumbers, ownNumbersFrom, TreeNumbering, type TaskNumbering } from '../register/numbering.ts';
import { JsonlEventLog } from '../register/store.ts';
import type { CliRuntime } from './runtime.ts';
import { loadTree } from './tree.ts';
import { fileLockOf } from './file-locks.ts';

/** The lowest task number a team issues: past every id of the tree it left (`team.detached`, T5469), else 1. */
function firstIdOf(config: KitConfig): number {
  return config.team?.detached?.firstId ?? 1;
}

/**
 * A team's numbering as its kit home's tree stands at the write (T1139): one across every register of the tree,
 * under the lock in the root team's state folder; the team's own when it hangs in no tree, or when its parents go
 * round a loop, which `doctor` names. Either way it starts past the ids of any tree a team of it left (T5469).
 */
export class KitTreeNumbering implements TaskNumbering {
  private readonly runtime: CliRuntime;
  private readonly team: string;
  private readonly config: KitConfig;

  constructor(runtime: CliRuntime, team: string, config: KitConfig) {
    this.runtime = runtime;
    this.team = team;
    this.config = config;
  }

  async issue<T>(write: (floor: number) => Promise<T>): Promise<T> {
    return (await this.numbering()).issue(write);
  }

  private async numbering(): Promise<TaskNumbering> {
    const own = ownNumbersFrom(firstIdOf(this.config));
    const { tree, teams } = await loadTree(this.runtime);
    const rootId = tree.rootOf(this.team);
    const root = rootId === undefined ? undefined : teams.get(rootId);
    if (rootId === undefined || root === undefined) {
      return own;
    }
    const others = tree
      .walk(rootId)
      .filter((step) => step.team !== this.team)
      .flatMap((step) => teams.get(step.team) ?? []);
    if (others.length === 0) {
      return own;
    }
    const { files } = this.runtime;
    const lock = fileLockOf(this.runtime, root.kit.paths.idsLock, this.config.lock);
    const first = Math.max(firstIdOf(this.config), ...others.map((other) => firstIdOf(other.config)));
    return new TreeNumbering(lock, others.map((other) => new LogNumbers(new JsonlEventLog(files, other.kit.paths.events))), first);
  }
}
