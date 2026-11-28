import { basename, dirname, join } from 'node:path';
import { readBundleFile } from '../adapters/terminals/protocol/bundle-files.ts';
import { keptManifestPath } from '../adapters/terminals/protocol/bundle-stage.ts';
import { readBundle, type ReadBundleFile } from '../adapters/terminals/protocol/bundle.ts';
import { MANIFEST_BYTES_CAP, readManifest, type HostManifest } from '../adapters/terminals/protocol/manifest.ts';
import { sha256Of } from '../adapters/terminals/protocol/spawn.ts';
import type { TerminalHostPin } from '../config/types.ts';
import { errorMessage } from '../core/guards.ts';
import { teamHome } from '../core/home.ts';

/**
 * Where a team's staged copies of its pinned host bundles live, and beside each the manifest it was staged from. A team
 * has its own, so what one team's pins keep or drop never takes a copy another team's pin runs.
 */
export function terminalHostsDir(kitHome: string, team: string): string {
  return join(teamHome(kitHome, team), 'terminal-hosts');
}

/** A whole file's bytes, links followed, undefined when it is not there: the read a host of one file runs by. */
export type OneFileRead = (path: string) => Promise<Uint8Array | undefined>;

/** How a host's files differ from its pin, in words for a check flag; undefined when they match it. */
export type HostPinChange = (pin: TerminalHostPin) => Promise<string | undefined>;

/** The most changed files a flag names; the rest are counted. */
const NAMED_FILES = 10;

function shortSha(sha256: string): string {
  return `${sha256.slice(0, 4)}…${sha256.slice(-4)}`;
}

function named(paths: readonly string[]): string {
  const rest = paths.length - NAMED_FILES;
  return `${paths.slice(0, NAMED_FILES).join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`;
}

function versionOf(manifest: HostManifest | undefined): string {
  return manifest === undefined ? '' : `${manifest.version}, `;
}

/** The files two manifests do not list alike, by path: changed, added or gone. */
function differing(before: HostManifest, after: HostManifest): readonly string[] {
  const paths = new Set([...before.files.keys(), ...after.files.keys()]);
  return [...paths].filter((path) => before.files.get(path) !== after.files.get(path)).sort();
}

/**
 * Reads pinned hosts' files against their pins, running nothing. A host of one file is read by `readFile`, the read its
 * transport runs it by, so a pin on a link (an install's usual shape) or a large binary is judged on the bytes that
 * would run. A bundle's pinned version and files come from the manifest kept when it was staged, read only while its
 * bytes still hash to the pin, so a host never staged here is named by its hashes alone.
 */
export function hostPinChanges(
  dir: string,
  readFile: OneFileRead,
  read: ReadBundleFile = readBundleFile,
  platform: NodeJS.Platform = process.platform,
): HostPinChange {
  const kept = async (sha256: string): Promise<HostManifest | undefined> => {
    const path = keptManifestPath(dir, sha256);
    const reading = await read(dirname(path), basename(path), MANIFEST_BYTES_CAP);
    if (reading.kind !== 'bytes' || sha256Of(reading.bytes) !== sha256) {
      return undefined;
    }
    const parsed = readManifest(reading.bytes);
    return parsed.kind === 'manifest' ? parsed.manifest : undefined;
  };
  const changeOf: HostPinChange = async (pin) => {
    if ('path' in pin) {
      const bytes = await readFile(pin.path);
      if (bytes === undefined) {
        return 'its file is not there';
      }
      const found = sha256Of(bytes);
      return found === pin.sha256 ? undefined : `pinned sha256 ${shortSha(pin.sha256)}; found sha256 ${shortSha(found)}`;
    }
    const reading = await readBundle(pin, { read, platform });
    switch (reading.kind) {
      case 'bundle':
        return undefined;
      case 'files-changed':
        return `pinned ${versionOf(reading.manifest)}manifest ${shortSha(pin.sha256)}; changed ${named(reading.paths)}`;
      case 'refused':
        return reading.why;
      case 'manifest-changed': {
        const before = await kept(pin.sha256);
        const { found } = reading;
        const changed = before === undefined || found === undefined ? '' : `; changed ${named(differing(before, found))}`;
        return `pinned ${versionOf(before)}manifest ${shortSha(pin.sha256)}; found ${found === undefined ? 'no readable ' : versionOf(found)}manifest ${shortSha(reading.sha256)}${changed}`;
      }
    }
  };
  return async (pin) => {
    try {
      return await changeOf(pin);
    } catch (error) {
      return `its files cannot be read: ${errorMessage(error)}`;
    }
  };
}
