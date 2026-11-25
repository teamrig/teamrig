import { join } from 'node:path';
import type { KitTree } from '../kit/kit-tree.ts';
import type { MemoryFiles } from './memory-files.ts';

/**
 * `KitTree` over `MemoryFiles`, for the kit install's specs: a copy reads and writes each file below the folder, and
 * `failCopyAfter` makes a copy throw once it wrote that many files, as a full disk or a held file would partway, and a
 * removal of a folder in `heldFolders` throws, leaving it whole, as Windows does for a folder a running process holds.
 */
export class MemoryKitTree implements KitTree {
  readonly copies: string[] = [];
  readonly heldFolders = new Set<string>();
  failCopyAfter: number | undefined;
  private readonly files: MemoryFiles;

  constructor(files: MemoryFiles) {
    this.files = files;
  }

  async copyFolder(from: string, to: string): Promise<void> {
    if ((await this.files.list(to)).length > 0 || (await this.files.read(to)) !== undefined) {
      throw new Error(`${to} exists already`);
    }
    this.copies.push(to);
    let written = 0;
    const copy = async (source: string, target: string): Promise<void> => {
      for (const name of await this.files.list(source)) {
        const text = await this.files.read(join(source, name));
        if (text === undefined) {
          await copy(join(source, name), join(target, name));
          continue;
        }
        if (this.failCopyAfter !== undefined && written >= this.failCopyAfter) {
          throw new Error('ENOSPC: no space left on device');
        }
        await this.files.write(join(target, name), text);
        written += 1;
      }
    };
    await copy(from, to);
  }

  async removeFolder(path: string): Promise<void> {
    if (this.heldFolders.has(path)) {
      throw new Error(`EBUSY: resource busy or locked, rmdir '${path}'`);
    }
    this.files.removeAll(path);
  }
}
