import type { FolderSignals, FolderWatch } from '../core/folder-signals.ts';
import { normalisePath } from './memory-files.ts';

interface OpenWatch {
  readonly folders: ReadonlySet<string>;
  readonly refused: Set<string>;
  readonly onChange: () => void;
}

/**
 * Folder watches in memory: a watch takes every folder `canWatch` allows (default every one) and tells of a change
 * only when a spec says one happened (`change`, `fail`). Folders are keyed as `MemoryFiles` keys paths.
 */
export class FakeFolderSignals implements FolderSignals {
  /** How many watches were opened, closed or not. */
  watchCount = 0;
  private readonly canWatch: (folder: string) => boolean;
  private readonly open = new Set<OpenWatch>();

  constructor(canWatch: (folder: string) => boolean = () => true) {
    this.canWatch = canWatch;
  }

  /** The watches not closed yet. */
  get openWatches(): number {
    return this.open.size;
  }

  /** Every folder an open watch holds, sorted and each once. */
  watched(): string[] {
    return [...new Set([...this.open].flatMap((each) => [...each.folders].filter((folder) => !each.refused.has(folder))))].sort();
  }

  watch(folders: readonly string[], onChange: () => void): FolderWatch {
    this.watchCount += 1;
    const keyed = new Set(folders.map(normalisePath));
    // `canWatch` is asked of each folder as the watcher named it, so a spec names folders as the code builds them.
    const refused = new Set(folders.filter((folder) => !this.canWatch(folder)).map(normalisePath));
    const opened: OpenWatch = { folders: keyed, refused, onChange };
    this.open.add(opened);
    return {
      unwatched: () => [...opened.refused],
      close: () => void this.open.delete(opened),
    };
  }

  /** Something in `folder` changed: each open watch holding it is told. */
  change(folder: string): void {
    for (const each of this.watchesOf(folder)) {
      each.onChange();
    }
  }

  /** The watch of `folder` ended with an error, as the system's does when the folder is removed: told, and refused from now. */
  fail(folder: string): void {
    for (const each of this.watchesOf(folder)) {
      each.refused.add(normalisePath(folder));
      each.onChange();
    }
  }

  private watchesOf(folder: string): OpenWatch[] {
    const key = normalisePath(folder);
    return [...this.open].filter((each) => each.folders.has(key) && !each.refused.has(key));
  }
}
