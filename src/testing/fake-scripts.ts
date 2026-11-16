import type { ScriptTexts } from '../secret-guard/script-reads.ts';

/**
 * Script files held in memory for the secret guard, keyed by path with `/` separators, so a test names `C:/w/x.js`
 * whichever separators the guard resolved the path with. It records each path read, so a test can show the guard
 * read nothing for a word it cannot know.
 */
export class FakeScripts implements ScriptTexts {
  readonly reads: string[] = [];
  private readonly files: ReadonlyMap<string, string>;

  constructor(files: Readonly<Record<string, string>> = {}) {
    this.files = new Map(Object.entries(files));
  }

  text(path: string): string | undefined {
    const key = path.replaceAll('\\', '/');
    this.reads.push(key);
    return this.files.get(key);
  }
}
