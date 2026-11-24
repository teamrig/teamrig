import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileSha256, pinSha256, processRuntimeProbe, readStoredPin, runningImageOf, RuntimeImageMismatchError, runtimeRefusal, shasumsUrl, type RuntimeImage, type RuntimePin } from './runtime-pin.ts';

const HASH = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const PIN: RuntimePin = { id: 'P1', path: '/usr/local/bin/node', sha256: HASH, version: 'v22.11.0', requester: 'owner', createdAt: '2030-01-07T10:00:00.000Z' };
const RUNNING: RuntimeImage = { path: PIN.path, sha256: HASH, version: PIN.version };

describe('readStoredPin and pinSha256 (#870)', () => {
  it('reads a pin as filed, and refuses one whose id, hash, path, version, requester or time does not fit', () => {
    assert.deepEqual(readStoredPin({ ...PIN }), PIN);
    for (const bad of [{ id: 'R1' }, { id: 'P0' }, { sha256: 'abc' }, { sha256: HASH.toUpperCase() }, { path: ' ' }, { version: '' }, { requester: 7 }, { createdAt: 'soon' }]) {
      assert.equal(readStoredPin({ ...PIN, ...bad }), undefined, JSON.stringify(bad));
    }
    assert.equal(readStoredPin('P1'), undefined);
  });

  it('binds the path, the hash and the version: a change to any gives another SHA-256', () => {
    const hashes = new Set([PIN, { ...PIN, path: '/opt/node/bin/node' }, { ...PIN, sha256: OTHER }, { ...PIN, version: 'v22.12.0' }].map(pinSha256));
    assert.equal(hashes.size, 4);
    assert.equal(pinSha256({ ...PIN }), pinSha256(PIN), 'one pin, one hash, whatever order its fields were built in');
  });

  it('points the reviewer at the release hashes of the pinned version', () => {
    assert.equal(shasumsUrl('v22.11.0'), 'https://nodejs.org/dist/v22.11.0/SHASUMS256.txt');
  });
});

describe('runtimeRefusal (#870)', () => {
  it('lets the approved runtime run: its path and its hash both match', () => {
    assert.equal(runtimeRefusal(RUNNING, PIN, 'linux'), undefined);
  });

  it('refuses every runtime while no pin is approved, naming the step that files one', () => {
    assert.match(runtimeRefusal(RUNNING, undefined, 'linux') ?? '', /none is approved: file the runtime to use with teamrig exec node-pin and have the security reviewer or the owner approve it\.$/u);
  });

  it('refuses another binary at the pinned path, naming the path, hash prefix and version found and expected', () => {
    const refusal = runtimeRefusal({ ...RUNNING, sha256: OTHER, version: 'v22.12.0' }, PIN, 'linux') ?? '';
    assert.equal(
      refusal,
      'the client runs under /usr/local/bin/node (bbbbbbbbbbbb, v22.12.0), not the approved /usr/local/bin/node (aaaaaaaaaaaa, v22.11.0) of P1. After a Node.js upgrade, file the runtime to use with teamrig exec node-pin and have the security reviewer or the owner approve it.',
    );
  });

  it('refuses the pinned binary at another path: the pin names one install', () => {
    assert.match(runtimeRefusal({ ...RUNNING, path: '/opt/nvm/node' }, PIN, 'linux') ?? '', /^the client runs under \/opt\/nvm\/node \(aaaaaaaaaaaa, v22\.11\.0\), not the approved/u);
    assert.notEqual(runtimeRefusal({ ...RUNNING, path: '/USR/local/bin/node' }, PIN, 'darwin'), undefined, 'a POSIX path keeps its case');
  });

  it('reads a Windows path with any case and either slash as the same file', () => {
    const windows: RuntimePin = { ...PIN, path: 'C:\\Program Files\\nodejs\\node.exe' };
    assert.equal(runtimeRefusal({ ...RUNNING, path: 'c:/program files/nodejs/NODE.EXE' }, windows, 'win32'), undefined);
  });
});

describe('the running runtime (#870)', () => {
  it('also holds the file to the image the kernel runs on Linux, and has no such image elsewhere', () => {
    assert.equal(runningImageOf('linux'), '/proc/self/exe');
    assert.equal(runningImageOf('darwin'), undefined);
    assert.equal(runningImageOf('win32'), undefined);
  });

  it('hashes the file a child will start, the real path, and refuses it when the running image hashes otherwise', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime-pin-'));
    try {
      const file = join(dir, 'node');
      const link = join(dir, 'node-link');
      const image = join(dir, 'image');
      await writeFile(file, 'the file at the path');
      await symlink(file, link);
      await writeFile(image, 'the file at the path');
      const real = await realpath(file);
      const sha256 = await fileSha256(file);
      const probe = processRuntimeProbe('linux', link, 'v22.11.0', image);
      assert.equal(await probe.path(), real, 'a bare node starts the real path');
      assert.deepEqual(await probe.current(), { path: real, sha256, version: 'v22.11.0' });
      await writeFile(image, 'the image that was started');
      const running = await fileSha256(image);
      await assert.rejects(probe.current(), (error: unknown) => {
        assert.ok(error instanceof RuntimeImageMismatchError);
        const expected = `the running Node.js image ${image} (${running.slice(0, 12)}) is not ${real} (${sha256.slice(0, 12)}), the file a bare node starts: it changed after this client started; start teamrig again`;
        assert.equal(error.message, expected);
        return true;
      });
      assert.deepEqual(await processRuntimeProbe('darwin', link, 'v22.11.0').current(), { path: real, sha256, version: 'v22.11.0' }, 'no running image to hold it to off Linux');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("streams a file's SHA-256", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime-pin-'));
    try {
      const file = join(dir, 'node');
      await writeFile(file, Buffer.from([0, 1, 2, 255]));
      assert.equal(await fileSha256(file), createHash('sha256').update(Buffer.from([0, 1, 2, 255])).digest('hex'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('names this process: the real path of process.execPath, the hash of its binary and process.version', async () => {
    const found = await processRuntimeProbe(process.platform, process.execPath, process.version).current();
    const path = await realpath(process.execPath);
    assert.deepEqual(found, { path, sha256: await fileSha256(path), version: process.version });
  });
});
