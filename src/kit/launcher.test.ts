import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parseVersion } from '../core/release-version.ts';
import { CLIENT_MANIFEST, clientFileHash } from '../exec/client-integrity.ts';
import { MemoryLauncherFiles } from '../testing/memory-launcher-files.ts';
import { kitCurrentPath, kitCurrentRecordPath, kitVersionFolder, kitVersionsFolder } from './kit-versions.ts';
import {
  checkInstall,
  ENTRY_FLAG,
  EVENT_FLAG,
  failureExit,
  isHookAnswer,
  isRelease,
  launch,
  LAUNCHER_ENTRIES,
  type LauncherProcess,
  LIST_PATH,
  parseVerified,
  readWords,
  textHash,
  VERIFIED_NAME,
} from './launcher.ts';

const KIT = join('/home/me/.teamrig/kit');
const VERSION = '1.2.3';
const FOLDER = join(KIT, 'versions', VERSION);
const LAUNCHER_HASH = 'a'.repeat(64);
const MAIN = 'dist/cli/main.js';

const SHIPPED: Readonly<Record<string, string>> = {
  'dist/cli/main.js': 'export {};\n',
  'dist/cli/guard-main.js': 'export const guard = 1;\n',
  'dist/core/words.js': 'export const words = 2;\r\n',
};

/** A kit home with one intact version, `current` naming it, and its record matching its list. */
function installed(): MemoryLauncherFiles {
  const files = new MemoryLauncherFiles();
  const list: Record<string, string> = {};
  for (const [path, text] of Object.entries(SHIPPED)) {
    files.put(join(FOLDER, path), text);
    list[path] = textHash(text);
  }
  const listText = `${JSON.stringify({ files: list }, null, 2)}\n`;
  files.put(join(FOLDER, LIST_PATH), listText);
  files.put(join(KIT, 'current'), `${VERSION}\n`);
  files.put(join(KIT, 'current.json'), JSON.stringify({ format: 1, version: VERSION, listHash: textHash(listText), source: { kind: 'claude-code-plugin' }, pinned: false }));
  return files;
}

describe('the launcher repeats what teamrig holds', () => {
  it('hashes a file as the build lists it, CRLF read as LF', () => {
    for (const text of ['a\r\nb\n', '', 'x']) assert.equal(textHash(text), clientFileHash(text));
  });

  it('reads the list where the build writes it', () => {
    assert.equal(LIST_PATH, CLIENT_MANIFEST);
  });

  it('names the records where the kit writes them', () => {
    assert.equal(join(KIT, 'current'), kitCurrentPath(KIT));
    assert.equal(join(KIT, 'current.json'), kitCurrentRecordPath(KIT));
    assert.equal(FOLDER, kitVersionFolder(KIT, VERSION));
    assert.equal(join(KIT, 'versions'), kitVersionsFolder(KIT));
  });

  it('takes the versions the release parser takes', () => {
    for (const text of ['1.2.3', '0.0.0', '10.20.30', '01.2.3', '1.2', '1.2.3+4', '1.2.3-pre','../1.2.3', '1.2.3 ', 'v1.2.3', '']) {
      assert.equal(isRelease(text), parseVersion(text) !== undefined, text);
    }
  });

  it('imports only Node modules, as it runs before any teamrig file is checked', async () => {
    const source = await readFile(new URL('./launcher.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^import [^;]*? from '([^']+)';$/gm)].map((match) => match[1]);
    assert.ok(imports.length > 0);
    for (const name of imports) assert.match(name ?? '', /^node:/);
  });
});

describe('checkInstall', () => {
  it('gives the entry of an intact install', async () => {
    assert.deepEqual(await checkInstall(installed(), KIT, MAIN, LAUNCHER_HASH), { kind: 'intact', entry: join(FOLDER, MAIN) });
  });

  it('refuses with no current, or one naming no plain version', async () => {
    for (const current of [undefined, '', '../1.2.3', '1.2.3/../../x', 'latest']) {
      const files = installed();
      if (current === undefined) files.put(join(KIT, 'current'), '\n');
      else files.put(join(KIT, 'current'), current);
      assert.deepEqual(await checkInstall(files, KIT, MAIN, LAUNCHER_HASH), { kind: 'broken', why: 'no teamrig installed' }, String(current));
    }
  });

  it('refuses a record naming another version, a changed list or a broken record', async () => {
    const otherVersion = installed();
    otherVersion.put(join(KIT, 'current.json'), JSON.stringify({ version: '1.2.4', listHash: textHash(otherVersion.text(join(FOLDER, LIST_PATH)) ?? '') }));
    const changedList = installed();
    changedList.put(join(FOLDER, LIST_PATH), `${changedList.text(join(FOLDER, LIST_PATH)) ?? ''} `);
    const notJson = installed();
    notJson.put(join(KIT, 'current.json'), '{');
    for (const files of [otherVersion, changedList, notJson]) {
      assert.deepEqual(await checkInstall(files, KIT, MAIN, LAUNCHER_HASH), { kind: 'broken', why: 'install record changed' });
    }
  });

  it('refuses a version folder or entry whose real path leaves versions/', async () => {
    const folderMoved = installed();
    folderMoved.links.set(FOLDER, join('/elsewhere'));
    folderMoved.addFolder(join('/elsewhere/dist'));
    const entryMoved = installed();
    entryMoved.links.set(join(FOLDER, MAIN), join('/elsewhere/main.js'));
    entryMoved.put(join('/elsewhere/main.js'), 'export {};\n');
    for (const files of [folderMoved, entryMoved]) {
      assert.deepEqual(await checkInstall(files, KIT, MAIN, LAUNCHER_HASH), { kind: 'broken', why: 'teamrig files moved' });
    }
  });

  it('refuses a file in dist/ the list does not name, and any node_modules folder', async () => {
    const stray = installed();
    stray.put(join(FOLDER, 'dist/cli/extra.js'), 'x');
    const modules = installed();
    modules.addFolder(join(FOLDER, 'node_modules'));
    const link = installed();
    link.links.set(join(FOLDER, 'dist/cli/linked.js'), join(FOLDER, 'dist/cli/main.js'));
    assert.deepEqual(await checkInstall(stray, KIT, MAIN, LAUNCHER_HASH), { kind: 'broken', why: 'teamrig files changed: dist/cli/extra.js not in the list' });
    assert.deepEqual(await checkInstall(modules, KIT, MAIN, LAUNCHER_HASH), { kind: 'broken', why: 'teamrig files changed: node_modules not in the list' });
    assert.deepEqual(await checkInstall(link, KIT, MAIN, LAUNCHER_HASH), { kind: 'broken', why: 'teamrig files changed: dist/cli/linked.js not in the list' });
  });

  it('refuses a listed file that changed or is gone, naming it', async () => {
    const files = installed();
    files.put(join(FOLDER, 'dist/core/words.js'), 'export const words = 3;\n');
    assert.deepEqual(await checkInstall(files, KIT, MAIN, LAUNCHER_HASH), { kind: 'broken', why: 'teamrig files changed: dist/core/words.js' });
  });

  it('hashes each file once, then trusts unchanged stats for the same list and launcher', async () => {
    const files = installed();
    assert.equal((await checkInstall(files, KIT, MAIN, LAUNCHER_HASH)).kind, 'intact');
    assert.ok(parseVerified(files.text(join(FOLDER, VERIFIED_NAME))));
    files.reads.length = 0;
    assert.equal((await checkInstall(files, KIT, MAIN, LAUNCHER_HASH)).kind, 'intact');
    assert.ok(!files.reads.includes(join(FOLDER, MAIN)), 'an unchanged file is not hashed again');
  });

  it('hashes again when a file’s time changes, and refuses a changed one', async () => {
    const files = installed();
    await checkInstall(files, KIT, MAIN, LAUNCHER_HASH);
    files.put(join(FOLDER, MAIN), 'export {}; \n');
    assert.deepEqual(await checkInstall(files, KIT, MAIN, LAUNCHER_HASH), { kind: 'broken', why: `teamrig files changed: ${MAIN}` });
  });

  it('misses the whole cache for another launcher, or when it is corrupt', async () => {
    const files = installed();
    await checkInstall(files, KIT, MAIN, LAUNCHER_HASH);
    files.putKeepingStats(join(FOLDER, MAIN), 'export {}!\n');
    assert.equal((await checkInstall(files, KIT, MAIN, LAUNCHER_HASH)).kind, 'intact', 'kept stats pass on the cache');
    assert.deepEqual(await checkInstall(files, KIT, MAIN, 'b'.repeat(64)), { kind: 'broken', why: `teamrig files changed: ${MAIN}` });
    files.put(join(FOLDER, VERIFIED_NAME), '{"listHash":');
    assert.deepEqual(await checkInstall(files, KIT, MAIN, LAUNCHER_HASH), { kind: 'broken', why: `teamrig files changed: ${MAIN}` });
  });

  it('never caches the stray-file walk', async () => {
    const files = installed();
    await checkInstall(files, KIT, MAIN, LAUNCHER_HASH);
    files.put(join(FOLDER, 'dist/late.js'), 'x');
    assert.equal((await checkInstall(files, KIT, MAIN, LAUNCHER_HASH)).kind, 'broken');
  });
});

describe('readWords', () => {
  it('takes the launcher flags off the front and keeps the CLI words', () => {
    assert.deepEqual(readWords([ENTRY_FLAG, 'guard-main', EVENT_FLAG, 'PreToolUse', 'hook', 'exec-guard', '--host', 'codex-cli']), {
      entry: LAUNCHER_ENTRIES.get('guard-main'),
      event: 'PreToolUse',
      rest: ['hook', 'exec-guard', '--host', 'codex-cli'],
    });
    assert.deepEqual(readWords(['list', EVENT_FLAG, 'x']), { entry: MAIN, event: undefined, rest: ['list', EVENT_FLAG, 'x'] });
  });

  it('reads an entry it does not know as none', () => {
    assert.equal(readWords([ENTRY_FLAG, '../../evil', 'hook']).entry, undefined);
  });
});

describe('failureExit', () => {
  const hook = (event: string | undefined): ReturnType<typeof readWords> => ({ entry: MAIN, event, rest: ['hook', 'x'] });

  it('ends a shell call 1', () => {
    assert.equal(failureExit({ entry: MAIN, event: undefined, rest: ['list'] }, 'why').code, 1);
  });

  it('lets context events and PostToolUse go on, saying what is off', () => {
    for (const event of ['SessionStart', 'Stop', 'SubagentStop', 'Notification', 'PreCompact', 'SessionEnd']) assert.equal(failureExit(hook(event), 'why').code, 0, event);
    const after = failureExit(hook('PostToolUse'), 'why');
    assert.equal(after.code, 0);
    assert.match(after.note, /secret redaction/);
  });

  it('blocks a prompt, a guard event, and an unknown or missing event', () => {
    for (const event of ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Something', undefined]) assert.equal(failureExit(hook(event), 'why').code, 2, String(event));
  });

  it('reads only 0 and 2 as hook answers', () => {
    assert.deepEqual([0, 1, 2, 3, 130].map(isHookAnswer), [true, false, true, false, false]);
  });
});

/** A process for `launch`, recording what it ran, wrote and how it ended. */
function fakeProcess(argv: readonly string[], files: MemoryLauncherFiles, run?: () => Promise<void>): LauncherProcess & { runs: [string, readonly string[]][]; errors: string[]; exits: number[]; fix?: (code: number) => number } {
  const host: LauncherProcess & { runs: [string, readonly string[]][]; errors: string[]; exits: number[]; fix?: (code: number) => number } = {
    argv,
    kitHome: KIT,
    launcherHash: LAUNCHER_HASH,
    files,
    runs: [],
    errors: [],
    exits: [],
    run: async (entry, words) => {
      host.runs.push([entry, words]);
      await run?.();
    },
    writeError: (text) => host.errors.push(text),
    onEnd: (fix) => {
      host.fix = fix;
    },
    exit: (code) => host.exits.push(code),
  };
  return host;
}

describe('launch', () => {
  it('runs the entry of an intact install with the CLI words', async () => {
    const host = fakeProcess([ENTRY_FLAG, 'guard-main', EVENT_FLAG, 'PreToolUse', 'hook', 'exec-guard'], installed());
    await launch(host);
    assert.deepEqual(host.runs, [[join(FOLDER, 'dist/cli/guard-main.js'), ['hook', 'exec-guard']]]);
    assert.deepEqual(host.exits, []);
  });

  it('blocks a guard event on a broken install and runs nothing', async () => {
    const files = installed();
    files.put(join(FOLDER, MAIN), 'changed');
    const host = fakeProcess([EVENT_FLAG, 'PreToolUse', 'hook', 'exec-guard'], files);
    await launch(host);
    assert.deepEqual(host.runs, []);
    assert.deepEqual(host.exits, [2]);
    assert.match(host.errors.join(''), /teamrig files changed: dist\/cli\/main\.js/);
  });

  it('refuses an entry word it does not know', async () => {
    const host = fakeProcess([ENTRY_FLAG, 'other', EVENT_FLAG, 'PreToolUse', 'hook', 'x'], installed());
    await launch(host);
    assert.deepEqual([host.runs, host.exits], [[], [2]]);
  });

  it('ends a failed import with the event’s exit', async () => {
    const host = fakeProcess([EVENT_FLAG, 'SessionStart', 'hook', 'session-start'], installed(), async () => {
      throw new Error('boom');
    });
    await launch(host);
    assert.deepEqual(host.exits, [0]);
    assert.match(host.errors.join(''), /could not start: boom/);
  });

  it('turns a hook run’s crash exit into the event’s exit, and keeps its answers', async () => {
    const host = fakeProcess([EVENT_FLAG, 'PreToolUse', 'hook', 'exec-guard'], installed());
    await launch(host);
    assert.deepEqual([host.fix?.(0), host.fix?.(2), host.fix?.(1), host.fix?.(7)], [0, 2, 2, 2]);
    const context = fakeProcess([EVENT_FLAG, 'Stop', 'hook', 'stop'], installed());
    await launch(context);
    assert.equal(context.fix?.(1), 0);
  });

  it('leaves a shell call’s exit to the CLI', async () => {
    const host = fakeProcess(['list'], installed());
    await launch(host);
    assert.equal(host.fix, undefined);
  });
});
