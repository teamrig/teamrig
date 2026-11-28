import { isRecord } from '../../../plugin-api/index.ts';
import { quoted } from './wire.ts';

/**
 * The manifest of an outside host that is more than one file (docs/design/public-interface.md, Terminals as a
 * protocol): `teamrig-host.json` beside the host's files, listing every file it runs by its sha256. The owner's pin
 * names the manifest by the sha256 of its bytes, so that one hash pins the whole bundle and its version.
 */

/** What a host's entry is: `native` runs itself; `node` runs under the node teamrig itself runs on. */
export const HOST_RUNTIMES = ['native', 'node'] as const;
export type HostRuntime = (typeof HOST_RUNTIMES)[number];

export interface HostManifest {
  readonly name: string;
  readonly version: string;
  readonly runtime: HostRuntime;
  /** The file to start, one of `files`. */
  readonly entry: string;
  /** Each file's sha256 by its path from the manifest's folder, parts joined by `/`. */
  readonly files: ReadonlyMap<string, string>;
}

export type ManifestReading = { readonly kind: 'manifest'; readonly manifest: HostManifest } | { readonly kind: 'refused'; readonly why: string };

/** The layout of the manifest this teamrig reads (its `teamrigHost`). */
export const MANIFEST_LAYOUT = 1;

/** The most bytes a manifest may hold: its file cap's worth of long paths and hashes. */
export const MANIFEST_BYTES_CAP = 256 * 1024;

/** The most files a bundle may list. A closed bundle is a few files; more is a source tree or a `node_modules`. */
export const BUNDLE_FILES_CAP = 256;

/** The most bytes a bundle's files may hold together, as every run reads, hashes and compares all of them. */
export const BUNDLE_BYTES_CAP = 64 * 1024 * 1024;

const SHA256 = /^[0-9a-f]{64}$/;
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
/** One part of a listed path: plain characters only, and no trailing dot, which Windows drops when it opens the file. */
const PATH_PART = /^[0-9A-Za-z_@+-][0-9A-Za-z_@+.-]*(?<!\.)$|^\.[0-9A-Za-z_@+-][0-9A-Za-z_@+.-]*(?<!\.)$/;
const PATH_LENGTH_CAP = 240;
/** The names Windows gives to devices, with any extension. */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;
/** Launchers whose interpreter, and whatever they call next, is looked up at run time, so no digest covers it. */
const LAUNCHER = /\.(?:cmd|bat|ps1|vbs|wsf|com|sh|bash|zsh|fish|command)$/i;
/** Entries node reads by their extension alone; a `.js` entry's kind comes from the nearest `package.json`. */
const NODE_ENTRY = /\.[mc]js$/;
/** Code whose kind node takes from the nearest `package.json`, which may be one outside the bundle. */
const PACKAGE_STEERED = /\.(?:js|ts|jsx|tsx)$/i;

function refused(why: string): ManifestReading {
  return { kind: 'refused', why };
}

function isRuntime(value: unknown): value is HostRuntime {
  return HOST_RUNTIMES.some((runtime) => runtime === value);
}

/** Why a listed path may not name a bundle's file, or undefined: it must stay in the folder and mean one file everywhere. */
function pathProblem(path: string): string | undefined {
  if (path.length > PATH_LENGTH_CAP) {
    return `is over ${PATH_LENGTH_CAP} characters`;
  }
  const parts = path.split('/');
  const plain = parts.every((part) => PATH_PART.test(part) && !DEVICE_NAME.test(part));
  return plain ? undefined : "is not a plain path inside the manifest's folder";
}

/**
 * Why the listed paths cannot be one folder of files: two that differ only in case are one file on Windows and macOS,
 * and a path that is another's folder is no file. Undefined when they can.
 */
function clash(paths: readonly string[]): string | undefined {
  const files = new Map<string, string>();
  for (const path of paths) {
    const other = files.get(path.toLowerCase());
    if (other !== undefined) {
      return `lists ${quoted(other)} and ${quoted(path)}, one file where case does not count`;
    }
    files.set(path.toLowerCase(), path);
  }
  for (const path of paths) {
    const parts = path.toLowerCase().split('/');
    for (let depth = 1; depth < parts.length; depth += 1) {
      const folder = files.get(parts.slice(0, depth).join('/'));
      if (folder !== undefined) {
        return `lists ${quoted(folder)} as a file and as the folder of ${quoted(path)}`;
      }
    }
  }
  return undefined;
}

/** Why the entry cannot be started by its name, or undefined; what its bytes are is `entryProblem`'s. */
function entryNameProblem(entry: string, runtime: HostRuntime, files: ReadonlyMap<string, string>): string | undefined {
  if (!files.has(entry)) {
    return `its entry ${quoted(entry)} is not one of its files`;
  }
  if (LAUNCHER.test(entry)) {
    return `its entry ${quoted(entry)} is a script launcher: what it starts is looked up at run time, so no digest covers it`;
  }
  if (runtime === 'native') {
    return undefined;
  }
  if (!NODE_ENTRY.test(entry)) {
    return `its node entry ${quoted(entry)} is not a .mjs or .cjs file`;
  }
  const steered = [...files.keys()].find((path) => PACKAGE_STEERED.test(path));
  return steered === undefined ? undefined : `it lists ${quoted(steered)}, whose kind node takes from the nearest package.json: a node bundle's code is .mjs or .cjs`;
}

/** Reads a manifest's bytes, the ones whose sha256 was checked. Every field is checked; a field it does not know is ignored. */
export function readManifest(bytes: Uint8Array): ManifestReading {
  if (bytes.byteLength > MANIFEST_BYTES_CAP) {
    return refused(`it is over ${MANIFEST_BYTES_CAP} bytes`);
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return refused('it is not JSON');
  }
  if (!isRecord(value) || value['teamrigHost'] !== MANIFEST_LAYOUT) {
    return refused(`it is not a host manifest of layout ${MANIFEST_LAYOUT}`);
  }
  const { name, version, runtime, entry, files: listed } = value;
  if (typeof name !== 'string' || !NAME.test(name)) {
    return refused('its name is not lower-case words joined by -');
  }
  if (typeof version !== 'string' || !VERSION.test(version)) {
    return refused('its version is not one short word');
  }
  if (!isRuntime(runtime)) {
    return refused(`its runtime is not one of ${HOST_RUNTIMES.join(', ')}`);
  }
  if (typeof entry !== 'string' || !isRecord(listed)) {
    return refused('it names no entry or no files');
  }
  const entries = Object.entries(listed);
  if (entries.length > BUNDLE_FILES_CAP) {
    return refused(`it lists ${entries.length} files; at most ${BUNDLE_FILES_CAP}`);
  }
  const files = new Map<string, string>();
  for (const [path, sha256] of entries) {
    const problem = pathProblem(path);
    if (problem !== undefined) {
      return refused(`its file ${quoted(path)} ${problem}`);
    }
    if (typeof sha256 !== 'string' || !SHA256.test(sha256)) {
      return refused(`its file ${quoted(path)} has no sha256 (64 lowercase hex characters)`);
    }
    files.set(path, sha256);
  }
  const problem = clash([...files.keys()]) ?? entryNameProblem(entry, runtime, files);
  return problem === undefined ? { kind: 'manifest', manifest: { name, version, runtime, entry, files } } : refused(problem);
}

/** The first bytes of the programs an operating system loads itself: ELF, and Mach-O in each width, order and the fat form. */
const NATIVE_MAGIC: readonly (readonly number[])[] = [
  [0x7f, 0x45, 0x4c, 0x46],
  [0xfe, 0xed, 0xfa, 0xce],
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xce, 0xfa, 0xed, 0xfe],
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xca, 0xfe, 0xba, 0xbe],
];
const WINDOWS_MAGIC: readonly number[] = [0x4d, 0x5a];

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, index) => bytes[index] === byte);
}

/**
 * Why a native entry's bytes are no program the system loads itself, or undefined. A script is refused by its
 * content, whatever its name: a `#!` line finds its interpreter at run time, and a text file with none is handed to a
 * shell by `execvp`. On Windows only an `.exe` is taken. A node entry is read by node, so its bytes are node's matter.
 */
export function entryProblem(manifest: HostManifest, bytes: Uint8Array, platform: NodeJS.Platform): string | undefined {
  if (manifest.runtime === 'node') {
    return undefined;
  }
  const entry = quoted(manifest.entry);
  if (platform === 'win32') {
    return /\.exe$/i.test(manifest.entry) && startsWith(bytes, WINDOWS_MAGIC) ? undefined : `its native entry ${entry} is not an .exe program`;
  }
  if (startsWith(bytes, [0x23, 0x21])) {
    return `its native entry ${entry} is a script (it starts with #!), whose interpreter is looked up at run time`;
  }
  return NATIVE_MAGIC.some((magic) => startsWith(bytes, magic)) ? undefined : `its native entry ${entry} is not a program this system loads itself`;
}
