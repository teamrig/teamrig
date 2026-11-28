import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BUNDLE_FILES_CAP, entryProblem, MANIFEST_BYTES_CAP, readManifest, type HostManifest } from './manifest.ts';

const SHA = 'a'.repeat(64);
const MANIFEST = { teamrigHost: 1, name: 'example-host', version: '1.4.0', runtime: 'node', entry: 'dist/host.mjs', files: { 'dist/host.mjs': SHA, 'dist/chunk-wire.mjs': SHA } };

function bytesOf(value: unknown): Uint8Array {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
}

/** Why `value` is refused; fails the spec when it is not. */
function whyOf(value: unknown): string {
  const reading = readManifest(bytesOf(value));
  assert.equal(reading.kind, 'refused');
  return reading.kind === 'refused' ? reading.why : '';
}

function filesOf(...paths: readonly string[]): Record<string, string> {
  return Object.fromEntries(paths.map((path) => [path, SHA]));
}

describe('readManifest', () => {
  it('reads each field and every listed file, ignoring a field it does not know', () => {
    const reading = readManifest(bytesOf({ ...MANIFEST, homepage: 'x' }));
    assert.deepEqual(reading, {
      kind: 'manifest',
      manifest: { name: 'example-host', version: '1.4.0', runtime: 'node', entry: 'dist/host.mjs', files: new Map(Object.entries(MANIFEST.files)) },
    });
  });

  it('refuses what is not JSON, not UTF-8, not layout 1 or over its size cap', () => {
    assert.match(whyOf('{'), /not JSON/);
    assert.equal(readManifest(new Uint8Array([0x22, 0xff, 0x22])).kind, 'refused');
    assert.match(whyOf([]), /not a host manifest of layout 1/);
    assert.match(whyOf({ ...MANIFEST, teamrigHost: 2 }), /not a host manifest of layout 1/);
    const padding = ' '.repeat(MANIFEST_BYTES_CAP - JSON.stringify(MANIFEST).length);
    assert.equal(readManifest(bytesOf(JSON.stringify(MANIFEST) + padding)).kind, 'manifest');
    assert.match(whyOf(`${JSON.stringify(MANIFEST)}${padding} `), /is over 262144 bytes/);
  });

  it('refuses a name, version or runtime of another shape, and a manifest with no entry or files', () => {
    for (const name of ['Example', 'a b', '', 7]) assert.match(whyOf({ ...MANIFEST, name }), /its name/);
    for (const version of ['1.0\n2', '', 'a b', 'x'.repeat(65), 7]) assert.match(whyOf({ ...MANIFEST, version }), /its version/);
    for (const runtime of ['deno', undefined]) assert.match(whyOf({ ...MANIFEST, runtime }), /its runtime is not one of native, node/);
    assert.match(whyOf({ ...MANIFEST, entry: 7 }), /names no entry or no files/);
    assert.match(whyOf({ ...MANIFEST, files: ['dist/host.mjs'] }), /names no entry or no files/);
  });

  it('takes as many files as the cap and refuses one more', () => {
    const many = (count: number): Record<string, string> => filesOf('dist/host.mjs', ...Array.from({ length: count - 1 }, (_, index) => `dist/c${index}.mjs`));
    assert.equal(readManifest(bytesOf({ ...MANIFEST, files: many(BUNDLE_FILES_CAP) })).kind, 'manifest');
    assert.match(whyOf({ ...MANIFEST, files: many(BUNDLE_FILES_CAP + 1) }), /lists 257 files; at most 256/);
  });

  it('refuses a listed path that leaves the folder or means another file on some system', () => {
    const paths = ['/abs.mjs', '../up.mjs', 'dist/../up.mjs', './host.mjs', 'dist//host.mjs', 'dist/', '', 'C:/host.mjs', 'dist\\host.mjs', 'host.mjs:stream', 'host.mjs.', 'host.mjs ', 'nul.mjs', 'dist/COM1', 'a\nb.mjs', 'é.mjs', 'x'.repeat(241)];
    for (const path of paths) {
      assert.match(whyOf({ ...MANIFEST, files: { ...MANIFEST.files, [path]: SHA } }), /plain path|over 240 characters/, JSON.stringify(path));
    }
    assert.equal(readManifest(bytesOf({ ...MANIFEST, files: { ...MANIFEST.files, 'node_modules/@scope/pkg/.meta.json': SHA } })).kind, 'manifest');
  });

  it('refuses two paths that are one file where case does not count, and a file that is another file’s folder', () => {
    assert.match(whyOf({ ...MANIFEST, files: { ...MANIFEST.files, 'dist/HOST.mjs': SHA } }), /one file where case does not count/);
    assert.match(whyOf({ ...MANIFEST, files: { ...MANIFEST.files, Dist: SHA } }), /as a file and as the folder of/);
  });

  it('refuses a file with no sha256 of 64 lowercase hex characters', () => {
    for (const sha256 of [SHA.toUpperCase(), '', 7]) {
      assert.match(whyOf({ ...MANIFEST, files: { ...MANIFEST.files, 'x.mjs': sha256 } }), /has no sha256/);
    }
  });

  it('refuses an entry it does not list, and a script launcher whatever its case', () => {
    assert.match(whyOf({ ...MANIFEST, entry: 'dist/other.mjs' }), /is not one of its files/);
    for (const entry of ['host.cmd', 'host.BAT', 'host.Ps1', 'host.sh']) {
      assert.match(whyOf({ ...MANIFEST, runtime: 'native', entry, files: filesOf(entry) }), /is a script launcher/, entry);
    }
  });

  it('takes a node entry of .mjs or .cjs only, with no code whose kind a package.json decides', () => {
    for (const entry of ['host.mjs', 'host.cjs']) {
      assert.equal(readManifest(bytesOf({ ...MANIFEST, entry, files: filesOf(entry) })).kind, 'manifest');
    }
    for (const entry of ['host.js', 'host.MJS', 'host.json', 'host']) {
      assert.match(whyOf({ ...MANIFEST, entry, files: filesOf(entry) }), /is not a \.mjs or \.cjs file/, entry);
    }
    assert.match(whyOf({ ...MANIFEST, files: filesOf('dist/host.mjs', 'dist/chunk.js') }), /"?dist\/chunk\.js"?, whose kind node takes from the nearest package\.json/);
  });
});

describe('entryProblem', () => {
  const native = (entry: string): HostManifest => ({ name: 'h', version: '1', runtime: 'native', entry, files: new Map([[entry, SHA]]) });
  const ELF = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2]);
  const MACH_O = new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 2]);
  const EXE = new Uint8Array([0x4d, 0x5a, 0x90]);

  it('takes a program the system loads itself', () => {
    assert.equal(entryProblem(native('host'), ELF, 'linux'), undefined);
    assert.equal(entryProblem(native('host'), MACH_O, 'darwin'), undefined);
    assert.equal(entryProblem(native('host.EXE'), EXE, 'win32'), undefined);
  });

  it('refuses a script by its content, whatever its name', () => {
    assert.match(entryProblem(native('host'), bytesOf('#!/bin/sh\n'), 'linux') ?? '', /starts with #!/);
    assert.match(entryProblem(native('host'), bytesOf('#!/bin/sh\n'), 'darwin') ?? '', /starts with #!/);
    // With no #! line, execvp hands a text file to a shell.
    assert.match(entryProblem(native('host'), bytesOf('echo hi\n'), 'linux') ?? '', /not a program this system loads itself/);
    assert.match(entryProblem(native('host'), new Uint8Array(), 'linux') ?? '', /not a program this system loads itself/);
  });

  it('takes only an .exe on Windows', () => {
    assert.match(entryProblem(native('host'), EXE, 'win32') ?? '', /is not an \.exe program/);
    assert.match(entryProblem(native('host.exe'), bytesOf('@echo off'), 'win32') ?? '', /is not an \.exe program/);
  });

  it("leaves a node entry's bytes to node", () => {
    assert.equal(entryProblem({ ...native('host.mjs'), runtime: 'node' }, bytesOf('export {};'), 'linux'), undefined);
  });
});
