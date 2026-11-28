import { dirname, normalize } from 'node:path';
import type { Files } from './files.ts';

/**
 * `Files` over another `Files` that, while recording, keeps each folder a call reaches into: the folder of a file it
 * stamps, sizes, dates or reads, and the folder it lists. A change to any of those files shows as a change in one of
 * those folders, which is what a folder watch can tell (core/folder-signals.ts). Every call passes through.
 */
export class ReachedFolders implements Files {
  private readonly inner: Files;
  private recording: Set<string> | undefined;

  constructor(inner: Files) {
    this.inner = inner;
  }

  /** Runs `work`, and gives its answer with the folders its calls reached, sorted and each once. */
  async record<T>(work: () => Promise<T>): Promise<{ readonly value: T; readonly folders: readonly string[] }> {
    const folders = new Set<string>();
    this.recording = folders;
    try {
      const value = await work();
      return { value, folders: [...folders].sort() };
    } finally {
      this.recording = undefined;
    }
  }

  read(path: string): Promise<string | undefined> {
    return this.inner.read(this.fileIn(path));
  }

  readTail(path: string, maxBytes: number): Promise<string | undefined> {
    return this.inner.readTail(this.fileIn(path), maxBytes);
  }

  readHead(path: string, maxBytes: number): Promise<string | undefined> {
    return this.inner.readHead(this.fileIn(path), maxBytes);
  }

  append(path: string, text: string): Promise<void> {
    return this.inner.append(path, text);
  }

  write(path: string, text: string): Promise<void> {
    return this.inner.write(path, text);
  }

  createExclusive(path: string, text: string): Promise<boolean> {
    return this.inner.createExclusive(path, text);
  }

  list(dir: string): Promise<string[]> {
    return this.inner.list(this.folder(dir));
  }

  makeFolder(path: string): Promise<void> {
    return this.inner.makeFolder(path);
  }

  remove(path: string): Promise<boolean> {
    return this.inner.remove(path);
  }

  move(from: string, to: string): Promise<boolean> {
    return this.inner.move(from, to);
  }

  stamp(path: string): Promise<string | undefined> {
    return this.inner.stamp(this.fileIn(path));
  }

  modifiedAt(path: string): Promise<number | undefined> {
    return this.inner.modifiedAt(this.fileIn(path));
  }

  size(path: string): Promise<number | undefined> {
    return this.inner.size(this.fileIn(path));
  }

  realPath(path: string): Promise<string | undefined> {
    return this.inner.realPath(this.fileIn(path));
  }

  isPlainFile(path: string): Promise<boolean> {
    return this.inner.isPlainFile(this.fileIn(path));
  }

  // Kept in the platform's form: teamrig names one folder with either separator, and each form would be a watch.
  private fileIn(path: string): string {
    this.recording?.add(normalize(dirname(path)));
    return path;
  }

  private folder(path: string): string {
    this.recording?.add(normalize(path));
    return path;
  }
}
