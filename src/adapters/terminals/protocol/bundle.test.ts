import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join, resolve, sep } from 'node:path';
import { ProgramOutputCapError, type Env, type ProgramRequest, type ProgramResult } from '../../../plugin-api/index.ts';
import { bundlePinProblem, bundleTransport, readBundle, type BundlePin, type BundlePorts, type CheckedBundle, type FileReading } from './bundle.ts';
import { BUNDLE_BYTES_CAP, MANIFEST_BYTES_CAP } from './manifest.ts';
import { PROTOCOL_OUTPUT_CAP_BYTES, sha256Of } from './spawn.ts';

const ROOT = resolve(sep, 'hosts', 'example');
const MANIFEST_PATH = join(ROOT, 'teamrig-host.json');
const STAGED = resolve(sep, 'staged');
const LINE = '{"jsonrpc":"2.0","id":1,"method":"capabilities","params":{}}\n';
const OK: ProgramResult = { end: { kind: 'exited', code: 0 }, stdout: '{"answer":1}\n', stderr: '' };

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const HOST = utf8('export {};\n');
const WIRE = utf8('export const wire = 1;\n');

function manifestOf(files: Readonly<Record<string, Uint8Array>>, over: Readonly<Record<string, unknown>> = {}): Uint8Array {
  const hashes = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, sha256Of(bytes)]));
  return utf8(JSON.stringify({ teamrigHost: 1, name: 'example-host', version: '1.4.0', runtime: 'node', entry: 'dist/host.mjs', files: hashes, ...over }));
}

const FILES = { 'dist/host.mjs': HOST, 'dist/chunk-wire.mjs': WIRE };
const MANIFEST = manifestOf(FILES);
const PIN: BundlePin = { manifest: MANIFEST_PATH, sha256: sha256Of(MANIFEST), args: ['--serve'] };

interface Recorded {
  readonly ports: BundlePorts;
  readonly reads: string[];
  readonly staged: CheckedBundle[];
  readonly runs: ProgramRequest[];
}

interface Options {
  readonly manifest?: Uint8Array | undefined;
  readonly files?: Readonly<Record<string, Uint8Array>>;
  readonly reading?: (path: string) => FileReading | undefined;
  readonly stage?: () => Promise<string>;
  readonly run?: () => Promise<ProgramResult>;
  readonly env?: Env;
  readonly platform?: NodeJS.Platform;
}

/** Ports over a bundle in memory, reading no more than the cap asked for; every call is recorded. */
function portsOf(options: Options = {}): Recorded {
  const reads: string[] = [];
  const staged: CheckedBundle[] = [];
  const runs: ProgramRequest[] = [];
  const manifest = 'manifest' in options ? options.manifest : MANIFEST;
  const files: Readonly<Record<string, Uint8Array>> = options.files ?? FILES;
  return {
    reads,
    staged,
    runs,
    ports: {
      read: async (root, path, cap) => {
        assert.equal(root, dirname(MANIFEST_PATH));
        reads.push(path);
        const special = options.reading?.(path);
        if (special !== undefined) {
          return special;
        }
        const bytes = path === 'teamrig-host.json' ? manifest : files[path];
        if (bytes === undefined) {
          return { kind: 'missing' };
        }
        return bytes.byteLength > cap ? { kind: 'refused', why: `is over the ${cap} bytes left for it` } : { kind: 'bytes', bytes };
      },
      stage: async (bundle) => {
        staged.push(bundle);
        return options.stage === undefined ? join(STAGED, bundle.sha256) : options.stage();
      },
      run: async (request) => {
        runs.push(request);
        return options.run === undefined ? OK : options.run();
      },
      env: options.env ?? {},
      node: '/usr/bin/the-node',
      platform: options.platform ?? 'linux',
    },
  };
}

async function failureOf(recorded: Recorded, pin: BundlePin = PIN): Promise<string> {
  const answer = await bundleTransport(pin, recorded.ports)(LINE);
  assert.equal(answer.kind, 'failed');
  return answer.kind === 'failed' ? answer.why : '';
}

describe('bundlePinProblem', () => {
  it('passes an absolute manifest path with a sha256, and refuses either of another shape', () => {
    assert.equal(bundlePinProblem(PIN), undefined);
    assert.match(bundlePinProblem({ ...PIN, manifest: 'teamrig-host.json' }) ?? '', /is not an absolute path/);
    assert.match(bundlePinProblem({ ...PIN, sha256: PIN.sha256.toUpperCase() }) ?? '', /holds no sha256/);
  });
});

describe('readBundle', () => {
  it('asks for no more than the manifest cap of its manifest, and refuses one past it unread', async () => {
    const recorded = portsOf({ manifest: new Uint8Array(MANIFEST_BYTES_CAP + 1) });
    assert.deepEqual(await readBundle(PIN, recorded.ports), { kind: 'refused', why: `its manifest is over the ${MANIFEST_BYTES_CAP} bytes left for it` });
  });

  it('reads the manifest once and each listed file once, and keeps the bytes it hashed', async () => {
    const recorded = portsOf();
    const reading = await readBundle(PIN, recorded.ports);
    assert.deepEqual(recorded.reads, ['teamrig-host.json', 'dist/host.mjs', 'dist/chunk-wire.mjs']);
    assert.equal(reading.kind, 'bundle');
    assert.deepEqual(reading.kind === 'bundle' ? [reading.bundle.manifestBytes, reading.bundle.sha256, reading.bundle.files] : [], [MANIFEST, PIN.sha256, new Map(Object.entries(FILES))]);
  });

  it('says what a changed manifest reads as, and reads no file of it', async () => {
    const manifest = manifestOf(FILES, { version: '1.5.0' });
    const recorded = portsOf({ manifest });
    const reading = await readBundle(PIN, recorded.ports);
    assert.deepEqual([reading.kind, reading.kind === 'manifest-changed' ? [reading.sha256, reading.found?.version] : []], ['manifest-changed', [sha256Of(manifest), '1.5.0']]);
    assert.deepEqual(recorded.reads, ['teamrig-host.json']);
    const broken = await readBundle(PIN, portsOf({ manifest: utf8('{') }).ports);
    assert.deepEqual(broken, { kind: 'manifest-changed', sha256: sha256Of(utf8('{')), found: undefined });
  });

  it('names every listed file that changed or is gone', async () => {
    const reading = await readBundle(PIN, portsOf({ files: { 'dist/host.mjs': WIRE } }).ports);
    assert.deepEqual([reading.kind, reading.kind === 'files-changed' ? reading.paths : []], ['files-changed', ['dist/host.mjs', 'dist/chunk-wire.mjs']]);
  });

  it('refuses a pinned manifest that is no manifest, one not there, and a file that may not be read', async () => {
    const bad = utf8('{}');
    assert.deepEqual(await readBundle({ ...PIN, sha256: sha256Of(bad) }, portsOf({ manifest: bad }).ports), { kind: 'refused', why: 'its manifest is refused: it is not a host manifest of layout 1' });
    assert.deepEqual(await readBundle(PIN, portsOf({ manifest: undefined }).ports), { kind: 'refused', why: 'its manifest is not there' });
    const link: FileReading = { kind: 'refused', why: 'is reached by a link' };
    assert.deepEqual(await readBundle(PIN, portsOf({ reading: () => link }).ports), { kind: 'refused', why: 'its manifest is reached by a link' });
    const linked = await readBundle(PIN, portsOf({ reading: (path) => (path === 'dist/host.mjs' ? link : undefined) }).ports);
    assert.deepEqual(linked, { kind: 'refused', why: 'its file dist/host.mjs is reached by a link' });
  });

  it('takes a bundle at the size cap and refuses one byte more', async () => {
    const big = (size: number): Readonly<Record<string, Uint8Array>> => ({ 'dist/host.mjs': HOST, 'dist/data.bin': new Uint8Array(size - HOST.byteLength) });
    for (const [size, kind] of [[BUNDLE_BYTES_CAP, 'bundle'], [BUNDLE_BYTES_CAP + 1, 'refused']] as const) {
      const files = big(size);
      const manifest = manifestOf(files);
      assert.equal((await readBundle({ ...PIN, sha256: sha256Of(manifest) }, portsOf({ manifest, files }).ports)).kind, kind, String(size));
    }
  });

  it('charges changed files to the size cap too, so one reading reads no more than the cap', async () => {
    const half = new Uint8Array(BUNDLE_BYTES_CAP / 2 + 1);
    const reading = await readBundle(PIN, portsOf({ files: { 'dist/host.mjs': half, 'dist/chunk-wire.mjs': half } }).ports);
    assert.deepEqual(reading, { kind: 'refused', why: `its file dist/chunk-wire.mjs is over the ${BUNDLE_BYTES_CAP / 2 - 1} bytes left for it` });
  });

  it('refuses a native entry that is a script by its content', async () => {
    const files = { 'bin/host': utf8('#!/bin/sh\necho hi\n') };
    const manifest = manifestOf(files, { runtime: 'native', entry: 'bin/host' });
    const reading = await readBundle({ ...PIN, sha256: sha256Of(manifest) }, portsOf({ manifest, files }).ports);
    assert.match(reading.kind === 'refused' ? reading.why : '', /is a script \(it starts with #!\)/);
  });
});

describe('bundleTransport', () => {
  it("runs a node host's staged entry under teamrig's node, with no other flag and the short env without NODE_OPTIONS", async () => {
    const recorded = portsOf({ env: { PATH: '/bin', NODE_OPTIONS: '--require /tmp/x.cjs', NODE_PATH: '/tmp', GH_TOKEN: 'key' } });
    assert.deepEqual(await bundleTransport(PIN, recorded.ports)(LINE), { kind: 'answered', output: OK.stdout });
    assert.deepEqual(recorded.runs, [{ program: '/usr/bin/the-node', args: [join(STAGED, PIN.sha256, 'dist', 'host.mjs'), '--serve'], env: { PATH: '/bin' }, input: LINE }]);
    assert.deepEqual(recorded.staged.map(({ files }) => files), [new Map(Object.entries(FILES))]);
  });

  it("runs a native host's staged entry itself", async () => {
    const files = { 'bin/host': new Uint8Array([0x7f, 0x45, 0x4c, 0x46]) };
    const manifest = manifestOf(files, { runtime: 'native', entry: 'bin/host' });
    const pin = { ...PIN, sha256: sha256Of(manifest) };
    const recorded = portsOf({ manifest, files });
    await bundleTransport(pin, recorded.ports)(LINE);
    assert.deepEqual(recorded.runs.map(({ program, args }) => [program, args]), [[join(STAGED, pin.sha256, 'bin', 'host'), ['--serve']]]);
  });

  it('reads and checks the whole bundle again on every request', async () => {
    const recorded = portsOf();
    const transport = bundleTransport(PIN, recorded.ports);
    await transport(LINE);
    await transport(LINE);
    assert.equal(recorded.reads.length, 6);
  });

  it('runs and stages nothing once a file or the manifest no longer matches', async () => {
    const file = portsOf({ files: { ...FILES, 'dist/chunk-wire.mjs': HOST } });
    assert.equal(await failureOf(file), `the terminal host ${MANIFEST_PATH} no longer matches its manifest (dist/chunk-wire.mjs), so teamrig does not run it until the owner pins it again`);
    const changed = manifestOf(FILES, { version: '1.5.0' });
    const manifest = portsOf({ manifest: changed });
    assert.match(await failureOf(manifest), new RegExp(`no longer matches its pin \\(its manifest's sha256 is now ${sha256Of(changed)}\\)`));
    const gone = portsOf({ manifest: undefined });
    assert.equal(await failureOf(gone), `the terminal host ${MANIFEST_PATH} is not run: its manifest is not there`);
    assert.deepEqual([file, manifest, gone].map(({ staged, runs }) => [staged, runs]), [[[], []], [[], []], [[], []]]);
  });

  it('fails a pin it cannot run without reading a file', async () => {
    const recorded = portsOf();
    assert.match(await failureOf(recorded, { ...PIN, manifest: 'teamrig-host.json' }), /is not an absolute path/);
    assert.deepEqual(recorded.reads, []);
  });

  it('fails, without running, when the copy cannot be made', async () => {
    const recorded = portsOf({ stage: () => Promise.reject(new Error('disk full')) });
    assert.equal(await failureOf(recorded), `teamrig could not read or copy the terminal host ${MANIFEST_PATH}: disk full`);
    const thrown = portsOf({ stage: () => Promise.reject('gone') });
    assert.match(await failureOf(thrown), /: gone$/);
    assert.deepEqual([recorded.runs, thrown.runs], [[], []]);
  });

  it('fails a run past its output cap, as a one-file program', async () => {
    const run = (): Promise<ProgramResult> => Promise.reject(new ProgramOutputCapError('node', PROTOCOL_OUTPUT_CAP_BYTES));
    assert.match(await failureOf(portsOf({ run })), /printed more than \d+ bytes, so teamrig stopped it/);
  });
});
