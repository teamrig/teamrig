import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LockBusyError } from '../core/lock.ts';
import { nodeProgramRunner, type ProgramRequest, type ProgramResult } from '../core/program-runner.ts';
import { BusyMutex } from '../testing/busy-mutex.ts';
import { InlineMutex } from '../testing/inline-mutex.ts';
import { RecordingMark } from '../testing/recording-mark.ts';
import { kitCurrentPath, kitCurrentRecordPath, kitVersionsFolder } from './kit-versions.ts';
import {
  kitMarkedPaths,
  markedMutex,
  NO_INSTALL_MARK,
  nodeInstallMark,
  posixInstallMark,
  windowsInstallMark,
  windowsMarkScript,
  type MarkedPath,
} from './install-mark.ts';

const PATHS: readonly MarkedPath[] = [{ path: 'a', tree: true }];

describe('kitMarkedPaths', () => {
  it('covers the versions tree and both records naming the one in use, never the launcher', () => {
    const kit = join('home', '.teamrig');
    assert.deepEqual(kitMarkedPaths(kit), [
      { path: kitVersionsFolder(kit), tree: true },
      { path: kitCurrentPath(kit), tree: false },
      { path: kitCurrentRecordPath(kit), tree: false },
    ]);
  });
});

describe('markedMutex', () => {
  it('lifts the mark before the task and sets it after, inside the lock', async () => {
    const log: string[] = [];
    const lock = new InlineMutex();
    const result = await markedMutex(lock, new RecordingMark(log), PATHS, () => { log.push('report'); }).run(async () => {
      log.push('task');
      return 7;
    });
    assert.equal(result, 7);
    assert.equal(lock.runs, 1);
    assert.deepEqual(log, ['lift a', 'task', 'set a']);
  });

  it('sets the mark again when the task throws, and throws the task error', async () => {
    const log: string[] = [];
    const run = markedMutex(new InlineMutex(), new RecordingMark(log), PATHS, () => { log.push('report'); }).run(async () => {
      log.push('task');
      throw new Error('install failed');
    });
    await assert.rejects(run, /install failed/);
    assert.deepEqual(log, ['lift a', 'task', 'set a']);
  });

  it('sets the mark again when the lift fails partway, and never runs the task', async () => {
    const log: string[] = [];
    const mark = new RecordingMark(log);
    mark.failLift = true;
    const run = markedMutex(new InlineMutex(), mark, PATHS, () => { log.push('report'); }).run(async () => {
      log.push('task');
    });
    await assert.rejects(run, /lift refused/);
    assert.deepEqual(log, ['lift a', 'set a']);
  });

  it('reports a failed set without throwing it: the change it guarded did happen', async () => {
    const log: string[] = [];
    const reported: unknown[] = [];
    const mark = new RecordingMark(log);
    mark.failSet = true;
    const result = await markedMutex(new InlineMutex(), mark, PATHS, (error) => { reported.push(error); }).run(async () => 'done');
    assert.equal(result, 'done');
    assert.equal(reported.length, 1);
    assert.ok(reported[0] instanceof Error);
    assert.match(reported[0].message, /set refused/);
  });

  it('lifts nothing when another process holds the lock', async () => {
    const log: string[] = [];
    const run = markedMutex(new BusyMutex(), new RecordingMark(log), PATHS, () => { log.push('report'); }).run(async () => {
      log.push('task');
    });
    await assert.rejects(run, LockBusyError);
    assert.deepEqual(log, []);
  });
});

/** The script a Windows PowerShell request runs, decoded from its -EncodedCommand argument. */
function decodedScript(request: ProgramRequest): string {
  const at = request.args.indexOf('-EncodedCommand');
  const encoded = request.args[at + 1];
  assert.ok(encoded !== undefined, 'the request carries an encoded script');
  return Buffer.from(encoded, 'base64').toString('utf16le');
}

/** The paths a mark script names, read back from its base64 JSON payload. */
function scriptPayload(script: string): string {
  const found = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(script);
  assert.ok(found?.[1] !== undefined, 'the script carries its paths as base64');
  return Buffer.from(found[1], 'base64').toString('utf8');
}

describe('windowsMarkScript', () => {
  const paths: readonly MarkedPath[] = [
    { path: "D:\\kits\\o'neil\\.teamrig\\versions", tree: true },
    { path: 'D:\\kits\\o\'neil\\.teamrig\\current', tree: false },
  ];

  it('carries the paths as base64 JSON, so a quote in a path needs no escaping', () => {
    const script = windowsMarkScript(paths, true);
    assert.deepEqual(JSON.parse(scriptPayload(script)), paths);
    assert.ok(!script.includes("o'neil"));
  });

  it('a set adds a deny entry for removal and writes, never SYNCHRONIZE or a generic Write', () => {
    const script = windowsMarkScript(paths, true);
    assert.match(script, /RemoveAccessRuleAll/);
    assert.match(script, /AddAccessRule/);
    assert.match(script, /'WriteData,AppendData,WriteExtendedAttributes,WriteAttributes,Delete,DeleteSubdirectoriesAndFiles'/);
    assert.match(script, /'ContainerInherit,ObjectInherit'/);
    assert.doesNotMatch(script, /Synchronize|'Write'|FullControl|Modify/);
    assert.match(script, /GetAccessControl\('Access'\)/);
  });

  it('a lift only removes the deny entries', () => {
    const script = windowsMarkScript(paths, false);
    assert.match(script, /RemoveAccessRuleAll/);
    assert.doesNotMatch(script, /AddAccessRule\(/);
  });
});

describe('windowsInstallMark', () => {
  const ok: ProgramResult = { end: { kind: 'exited', code: 0 }, stdout: '', stderr: '' };

  it('runs Windows PowerShell from its absolute path under SystemRoot, with the set or lift script', async () => {
    const requests: ProgramRequest[] = [];
    const run = async (request: ProgramRequest): Promise<ProgramResult> => {
      requests.push(request);
      return ok;
    };
    const mark = windowsInstallMark({ run, systemRoot: 'D:\\Win' });
    await mark.set(PATHS);
    await mark.lift(PATHS);
    assert.deepEqual(
      requests.map((request) => request.program),
      ['D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
    );
    const [setRequest, liftRequest] = requests;
    assert.ok(setRequest !== undefined && liftRequest !== undefined);
    assert.equal(decodedScript(setRequest), windowsMarkScript(PATHS, true));
    assert.equal(decodedScript(liftRequest), windowsMarkScript(PATHS, false));
    assert.ok(setRequest.args.includes('-NoProfile') && setRequest.args.includes('-NonInteractive'));
  });

  it('throws what PowerShell printed when it exits non-zero', async () => {
    const mark = windowsInstallMark({
      run: async () => ({ end: { kind: 'exited', code: 1 }, stdout: '', stderr: 'Access is denied.\r\n' }),
      systemRoot: 'C:\\Windows',
    });
    await assert.rejects(mark.set(PATHS), /the install mark could not be set: Access is denied\.$/);
    await assert.rejects(mark.lift(PATHS), /the install mark could not be lifted: Access is denied\.$/);
  });

  it('throws when PowerShell was stopped by a signal', async () => {
    const mark = windowsInstallMark({ run: async () => ({ end: { kind: 'signal', signal: 'SIGTERM' }, stdout: '', stderr: '' }), systemRoot: 'C:\\Windows' });
    await assert.rejects(mark.set(PATHS), /could not be set: no output/);
  });
});

describe('NO_INSTALL_MARK', () => {
  it('lifts and sets nothing, and never fails', async () => {
    await NO_INSTALL_MARK.lift(PATHS);
    await NO_INSTALL_MARK.set(PATHS);
  });
});

/** The write bits of a file's mode: a file's bits mean the same on every OS (Windows maps them to read-only). */
async function writeBits(path: string): Promise<number> {
  return (await stat(path)).mode & 0o222;
}

describe('posixInstallMark, on real files', () => {
  let root = '';
  const mark = posixInstallMark();

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'posix-mark-'));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('a set takes every write bit off the files in a tree and a single file; a lift gives the owner its bit back', async () => {
    const tree = join(root, 'versions');
    const kept = join(tree, '1.0.0', 'teamrig.mjs');
    const single = join(root, 'current');
    await mkdir(join(tree, '1.0.0'), { recursive: true });
    await writeFile(kept, 'kept');
    await writeFile(single, '1.0.0');
    const paths: readonly MarkedPath[] = [
      { path: tree, tree: true },
      { path: single, tree: false },
      { path: join(root, 'missing.json'), tree: false },
    ];
    await mark.set(paths);
    assert.equal(await writeBits(kept), 0);
    assert.equal(await writeBits(single), 0);
    await mark.lift(paths);
    assert.equal((await writeBits(kept)) & 0o200, 0o200);
    assert.equal((await writeBits(single)) & 0o200, 0o200);
  });

  it('marks only the folder itself, never what it holds, when the path is no tree', async () => {
    const folder = join(root, 'plain');
    const inside = join(folder, 'inside.txt');
    await mkdir(folder);
    await writeFile(inside, 'x');
    await mark.set([{ path: folder, tree: false }]);
    assert.equal((await writeBits(inside)) & 0o200, 0o200);
    await mark.lift([{ path: folder, tree: false }]);
  });
});

/** Whether a write-like step is refused, as the mark means it to be. */
async function refused(step: () => Promise<unknown>): Promise<boolean> {
  try {
    await step();
    return false;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      return true;
    }
    throw error;
  }
}

describe('the mark of the running platform, on real files', () => {
  let root = '';
  let versions = '';
  let current = '';
  let paths: readonly MarkedPath[] = [];
  const mark = nodeInstallMark(process.platform, nodeProgramRunner(60_000), process.env['SystemRoot']);

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'install-mark-'));
    versions = join(root, 'versions');
    current = join(root, 'current');
    await mkdir(join(versions, '1.0.0'), { recursive: true });
    await writeFile(join(versions, '1.0.0', 'teamrig.mjs'), 'kept');
    await writeFile(current, '1.0.0');
    paths = [
      { path: versions, tree: true },
      { path: current, tree: false },
      { path: join(root, 'missing.json'), tree: false },
    ];
  });

  after(async () => {
    await mark.lift(paths);
    await rm(root, { recursive: true, force: true });
  });

  it('a set refuses a write, a new file and a removal in the tree, and a write to a file, yet reads work', async () => {
    await mark.set(paths);
    const kept = join(versions, '1.0.0', 'teamrig.mjs');
    assert.equal(await readFile(kept, 'utf8'), 'kept');
    assert.equal(await readFile(current, 'utf8'), '1.0.0');
    assert.ok(await refused(() => writeFile(kept, 'changed')), 'a write in the tree is refused');
    assert.ok(await refused(() => writeFile(join(versions, '1.0.0', 'new.mjs'), 'new')), 'a new file in the tree is refused');
    assert.ok(await refused(() => unlink(kept)), 'a removal in the tree is refused');
    assert.ok(await refused(() => writeFile(current, '2.0.0')), 'a write to a marked file is refused');
    assert.equal(await readFile(kept, 'utf8'), 'kept');
  });

  it('a lift lets every write through again, and skips a missing path', async () => {
    await mark.set(paths);
    await mark.lift(paths);
    const kept = join(versions, '1.0.0', 'teamrig.mjs');
    await writeFile(kept, 'changed');
    await writeFile(join(versions, '1.0.0', 'new.mjs'), 'new');
    await unlink(join(versions, '1.0.0', 'new.mjs'));
    await writeFile(current, '2.0.0');
    assert.equal(await readFile(kept, 'utf8'), 'changed');
    assert.equal(await readFile(current, 'utf8'), '2.0.0');
  });
});
