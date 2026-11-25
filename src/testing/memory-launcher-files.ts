import { dirname, join } from 'node:path';
import type { LauncherEntry, LauncherFiles, LauncherStat } from '../kit/launcher.ts';

/** One stored file: its text and the stats the launcher's speed cache compares. */
interface StoredFile {
  text: string;
  mtimeMs: number;
  ino: number;
}

/**
 * `LauncherFiles` in memory, for the launcher's specs. Folders exist where a file or `addFolder` puts them; `links`
 * maps a path to the real path it resolves to and lists it as `other`, as a symbolic link or junction reads; `reads`
 * counts each file read, so a spec sees whether the speed cache skipped a hash.
 */
export class MemoryLauncherFiles implements LauncherFiles {
  readonly reads: string[] = [];
  readonly links = new Map<string, string>();
  private readonly files = new Map<string, StoredFile>();
  private readonly folders = new Set<string>();
  private nextIno = 1;
  private clock = 1_000;

  put(path: string, text: string): void {
    const key = join(path);
    const old = this.files.get(key);
    this.clock += 1;
    this.files.set(key, { text, mtimeMs: this.clock, ino: old?.ino ?? this.nextIno++ });
    this.addFolder(dirname(key));
  }

  /** Changes a file's text and keeps its time and inode, as an edit that resets the time would; same-length text keeps the size. */
  putKeepingStats(path: string, text: string): void {
    const old = this.files.get(join(path));
    if (old === undefined) throw new Error(`no file ${path}`);
    old.text = text;
  }

  text(path: string): string | undefined {
    return this.files.get(join(path))?.text;
  }

  addFolder(path: string): void {
    let folder = join(path);
    while (!this.folders.has(folder) && dirname(folder) !== folder) {
      this.folders.add(folder);
      folder = dirname(folder);
    }
  }

  async read(path: string): Promise<string | undefined> {
    const key = join(path);
    this.reads.push(key);
    return this.files.get(key)?.text;
  }

  async realPath(path: string): Promise<string | undefined> {
    let key = join(path);
    for (const [link, target] of this.links) {
      if (key === link || key.startsWith(`${link}${join('/')}`)) key = join(target, key.slice(link.length));
    }
    return this.files.has(key) || this.folders.has(key) ? key : undefined;
  }

  async list(folder: string): Promise<readonly LauncherEntry[] | undefined> {
    const key = join(folder);
    if (!this.folders.has(key)) return undefined;
    const names = new Map<string, LauncherEntry['kind']>();
    for (const path of this.files.keys()) if (dirname(path) === key) names.set(path.slice(key.length + 1), 'file');
    for (const path of this.folders) if (dirname(path) === key && path !== key) names.set(path.slice(key.length + 1), 'folder');
    for (const path of this.links.keys()) if (dirname(path) === key) names.set(path.slice(key.length + 1), 'other');
    return [...names].map(([name, kind]) => ({ name, kind }));
  }

  async stat(path: string): Promise<LauncherStat | undefined> {
    const found = this.files.get(join(path));
    return found === undefined ? undefined : { size: Buffer.byteLength(found.text), mtimeMs: found.mtimeMs, ino: found.ino };
  }

  async replace(path: string, text: string): Promise<void> {
    this.put(path, text);
  }
}
