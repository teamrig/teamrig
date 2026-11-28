import { basename, dirname, isAbsolute, join } from 'node:path';
import type { Transport } from './client.ts';
import { BUNDLE_BYTES_CAP, entryProblem, MANIFEST_BYTES_CAP, readManifest, type HostManifest } from './manifest.ts';
import { isSha256, runPinned, sha256Of, shortEnv, type PinnedRunPorts } from './spawn.ts';
import { failed, quoted } from './wire.ts';

/** The host bundle the owner pinned: its manifest's absolute path, the sha256 of that manifest's bytes, and the arguments it runs with. */
export interface BundlePin {
  readonly manifest: string;
  readonly sha256: string;
  readonly args: readonly string[];
}

/** What one read of a bundle's file gave: its bytes, no file, or why it is not one teamrig reads. */
export type FileReading = { readonly kind: 'bytes'; readonly bytes: Uint8Array } | { readonly kind: 'missing' } | { readonly kind: 'refused'; readonly why: string };

/** Reads one file under `root` by its path from there, at most `cap` bytes of it, following no link below `root`. */
export type ReadBundleFile = (root: string, path: string, cap: number) => Promise<FileReading>;

/** A bundle's checked bytes, each file read once. */
export interface CheckedBundle {
  readonly manifest: HostManifest;
  /** The manifest's own bytes, the ones `sha256` is of. */
  readonly manifestBytes: Uint8Array;
  readonly sha256: string;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

export type BundleReading =
  | { readonly kind: 'bundle'; readonly bundle: CheckedBundle }
  /** The manifest's bytes are not the pinned ones; `found` is what they read as, when they are a manifest. */
  | { readonly kind: 'manifest-changed'; readonly sha256: string; readonly found: HostManifest | undefined }
  /** The pinned manifest holds, and these listed files do not match it (a missing one too). */
  | { readonly kind: 'files-changed'; readonly manifest: HostManifest; readonly paths: readonly string[] }
  | { readonly kind: 'refused'; readonly why: string };

export interface BundlePorts extends Pick<PinnedRunPorts, 'run' | 'env'> {
  readonly read: ReadBundleFile;
  /**
   * Puts the bundle's files, and nothing else, in a folder of its manifest's sha256 only this user can open, and gives
   * that folder. A folder already holding exactly those bytes may be given again.
   */
  readonly stage: (bundle: CheckedBundle) => Promise<string>;
  /** The node teamrig itself runs on (`process.execPath`), never one found on PATH. */
  readonly node: string;
  readonly platform: NodeJS.Platform;
}

/** Why a bundle's pin cannot run at all, or undefined. */
export function bundlePinProblem(pin: BundlePin): string | undefined {
  if (!isAbsolute(pin.manifest)) {
    return `the terminal host's pinned manifest ${quoted(pin.manifest)} is not an absolute path`;
  }
  return isSha256(pin.sha256) ? undefined : `the terminal host's pin holds no sha256 (64 lowercase hex characters)`;
}

/**
 * Reads a bundle as its pin names it, each file once: the manifest's bytes are hashed and those same bytes are parsed,
 * and each listed file's bytes are hashed and kept, so what was checked is what is staged and run.
 */
export async function readBundle(pin: BundlePin, ports: Pick<BundlePorts, 'read' | 'platform'>): Promise<BundleReading> {
  const root = dirname(pin.manifest);
  const reading = await ports.read(root, basename(pin.manifest), MANIFEST_BYTES_CAP);
  if (reading.kind !== 'bytes') {
    return { kind: 'refused', why: reading.kind === 'missing' ? 'its manifest is not there' : `its manifest ${reading.why}` };
  }
  const sha256 = sha256Of(reading.bytes);
  const parsed = readManifest(reading.bytes);
  if (sha256 !== pin.sha256) {
    return { kind: 'manifest-changed', sha256, found: parsed.kind === 'manifest' ? parsed.manifest : undefined };
  }
  if (parsed.kind === 'refused') {
    return { kind: 'refused', why: `its manifest is refused: ${parsed.why}` };
  }
  const { manifest } = parsed;
  const files = new Map<string, Uint8Array>();
  const changed: string[] = [];
  let left = BUNDLE_BYTES_CAP;
  for (const [path, expected] of manifest.files) {
    const file = await ports.read(root, path, left);
    if (file.kind === 'refused') {
      return { kind: 'refused', why: `its file ${quoted(path)} ${file.why}` };
    }
    if (file.kind === 'missing') {
      changed.push(path);
      continue;
    }
    // Every byte read is charged, matched or not, so one reading reads no more than the cap however many files changed.
    left -= file.bytes.byteLength;
    if (sha256Of(file.bytes) !== expected) {
      changed.push(path);
      continue;
    }
    files.set(path, file.bytes);
  }
  if (changed.length > 0) {
    return { kind: 'files-changed', manifest, paths: changed };
  }
  const entry = files.get(manifest.entry);
  const problem = entry === undefined ? undefined : entryProblem(manifest, entry, ports.platform);
  return problem === undefined ? { kind: 'bundle', bundle: { manifest, manifestBytes: reading.bytes, sha256, files } } : { kind: 'refused', why: problem };
}

/** Why a reading is not a bundle to run. */
function notRun(reading: Exclude<BundleReading, { readonly kind: 'bundle' }>): string {
  const again = 'so teamrig does not run it until the owner pins it again';
  switch (reading.kind) {
    case 'manifest-changed':
      return `no longer matches its pin (its manifest's sha256 is now ${reading.sha256}), ${again}`;
    case 'files-changed':
      return `no longer matches its manifest (${reading.paths.map(quoted).join(', ')}), ${again}`;
    case 'refused':
      return `is not run: ${reading.why}`;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The transport to a pinned host bundle, run once per request line, as `pinnedTransport` is to a one-file program:
 * each run reads and checks the whole bundle, stages the checked bytes and runs the staged entry, with its pinned
 * arguments, the request line on stdin and the short environment. A `node` host gets no node flag but its entry.
 * Every failure is an answer, never a throw.
 */
export function bundleTransport(pin: BundlePin, ports: BundlePorts): Transport {
  const problem = bundlePinProblem(pin);
  const env = shortEnv(ports.env);
  const label = `the terminal host ${pin.manifest}`;
  return async (line) => {
    if (problem !== undefined) {
      return failed(problem);
    }
    let program: string;
    let args: readonly string[];
    try {
      const reading = await readBundle(pin, ports);
      if (reading.kind !== 'bundle') {
        return failed(`${label} ${notRun(reading)}`);
      }
      const { manifest } = reading.bundle;
      const entry = join(await ports.stage(reading.bundle), ...manifest.entry.split('/'));
      program = manifest.runtime === 'node' ? ports.node : entry;
      args = manifest.runtime === 'node' ? [entry, ...pin.args] : pin.args;
    } catch (error) {
      return failed(`teamrig could not read or copy ${label}: ${quoted(messageOf(error))}`);
    }
    return runPinned(label, ports.run, { program, args, env, input: line });
  };
}
