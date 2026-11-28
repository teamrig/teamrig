import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve, sep } from 'node:path';
import type { ReadBundleFile } from '../adapters/terminals/protocol/bundle.ts';
import { BUNDLE_BYTES_CAP } from '../adapters/terminals/protocol/manifest.ts';
import { sha256Of } from '../adapters/terminals/protocol/spawn.ts';
import type { TerminalHostPin } from '../config/types.ts';
import { hostPinChanges, terminalHostsDir } from './terminal-host-pins.ts';

const DIR = terminalHostsDir(resolve(sep, 'kit'), 'team');
const ROOT = resolve(sep, 'example');

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function short(bytes: Uint8Array): string {
  const sha256 = sha256Of(bytes);
  return `${sha256.slice(0, 4)}…${sha256.slice(-4)}`;
}

function manifestOf(version: string, files: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const hashes = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, sha256Of(bytes)]));
  return utf8(JSON.stringify({ teamrigHost: 1, name: 'example-host', version, runtime: 'node', entry: 'host.mjs', files: hashes }));
}

const OLD = manifestOf('1.4.0', { 'host.mjs': utf8('a'), 'gone.mjs': utf8('b') });
const NEW = manifestOf('1.5.0', { 'host.mjs': utf8('c'), 'added.mjs': utf8('d') });
const PIN: TerminalHostPin = { manifest: join(ROOT, 'teamrig-host.json'), sha256: sha256Of(OLD), args: [] };

/** Reads over the files in memory, by their full path. */
function readsOf(files: Readonly<Record<string, Uint8Array>>): ReadBundleFile {
  const byPath = new Map(Object.entries(files));
  return async (root, path) => {
    const bytes = byPath.get(join(root, ...path.split('/')));
    return bytes === undefined ? { kind: 'missing' } : { kind: 'bytes', bytes };
  };
}

/** The one-file read over the same files, by full path. */
function readFileOf(files: Readonly<Record<string, Uint8Array>>): (path: string) => Promise<Uint8Array | undefined> {
  return async (path) => files[path];
}

function changeOf(pin: TerminalHostPin, files: Readonly<Record<string, Uint8Array>>): Promise<string | undefined> {
  return hostPinChanges(DIR, readFileOf(files), readsOf(files), 'linux')(pin);
}

describe('hostPinChanges: a host of one file', () => {
  const bytes = utf8('program');
  const path = join(ROOT, 'host');
  const pin: TerminalHostPin = { path, sha256: sha256Of(bytes), args: [] };

  it('finds no change while the file matches', async () => {
    assert.equal(await changeOf(pin, { [path]: bytes }), undefined);
  });

  it('names both hashes of a changed file, and a file that is gone or may not be read', async () => {
    assert.equal(await changeOf(pin, { [path]: utf8('other') }), `pinned sha256 ${short(bytes)}; found sha256 ${short(utf8('other'))}`);
    assert.equal(await changeOf(pin, {}), 'its file is not there');
  });

  it('judges the bytes the one-file read gives, so a pin on a link or on a file over the bundle cap matches', async () => {
    const linked = hostPinChanges(DIR, async () => bytes, async () => ({ kind: 'refused', why: 'is reached by a link' }));
    assert.equal(await linked(pin), undefined);
    const large = new Uint8Array(BUNDLE_BYTES_CAP + 1);
    assert.equal(await changeOf({ path, sha256: sha256Of(large), args: [] }, { [path]: large }), undefined);
  });
});

describe('hostPinChanges: a host of a manifest', () => {
  const manifest = join(ROOT, 'teamrig-host.json');
  const host = join(ROOT, 'host.mjs');
  const gone = join(ROOT, 'gone.mjs');
  const kept = join(DIR, `${sha256Of(OLD)}.json`);

  it('finds no change while every file matches', async () => {
    assert.equal(await changeOf(PIN, { [manifest]: OLD, [host]: utf8('a'), [gone]: utf8('b') }), undefined);
  });

  it('names the files that no longer match the pinned manifest', async () => {
    assert.equal(await changeOf(PIN, { [manifest]: OLD, [host]: utf8('x') }), `pinned 1.4.0, manifest ${short(OLD)}; changed host.mjs, gone.mjs`);
  });

  it('names both versions and the differing files of a changed manifest, by the one kept when it was staged', async () => {
    assert.equal(
      await changeOf(PIN, { [manifest]: NEW, [kept]: OLD }),
      `pinned 1.4.0, manifest ${short(OLD)}; found 1.5.0, manifest ${short(NEW)}; changed added.mjs, gone.mjs, host.mjs`,
    );
  });

  it('names the hashes alone when no manifest was kept, or the kept one is not the pinned bytes', async () => {
    const plain = `pinned manifest ${short(OLD)}; found 1.5.0, manifest ${short(NEW)}`;
    assert.equal(await changeOf(PIN, { [manifest]: NEW }), plain);
    assert.equal(await changeOf(PIN, { [manifest]: NEW, [kept]: NEW }), plain);
  });

  it('says so when what it found is no manifest, or none is there', async () => {
    assert.equal(await changeOf(PIN, { [manifest]: utf8('{'), [kept]: OLD }), `pinned 1.4.0, manifest ${short(OLD)}; found no readable manifest ${short(utf8('{'))}`);
    assert.equal(await changeOf(PIN, {}), 'its manifest is not there');
  });

  it('reads a pinned and kept file that is no manifest as one with no version', async () => {
    const bad = utf8('{}');
    const badPin: TerminalHostPin = { manifest, sha256: sha256Of(bad), args: [] };
    assert.equal(await changeOf(badPin, { [manifest]: NEW, [join(DIR, `${sha256Of(bad)}.json`)]: bad }), `pinned manifest ${short(bad)}; found 1.5.0, manifest ${short(NEW)}`);
  });

  it('names at most ten changed files and counts the rest', async () => {
    const files = Object.fromEntries(['host.mjs', ...Array.from({ length: 11 }, (_, index) => `c${index}.mjs`)].map((path) => [path, utf8(path)]));
    const many = manifestOf('1.4.0', files);
    const change = await changeOf({ manifest, sha256: sha256Of(many), args: [] }, { [manifest]: many });
    assert.match(change ?? '', /c8\.mjs and 2 more$/);
  });

  it('answers a read the system refused, never throwing', async () => {
    const refusing: ReadBundleFile = () => Promise.reject(new Error('EACCES'));
    assert.equal(await hostPinChanges(DIR, readFileOf({}), refusing)(PIN), 'its files cannot be read: EACCES');
  });
});
