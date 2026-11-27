import { join } from 'node:path';
import type { Files } from './files.ts';

/** The file under the kit home that names this machine to an owner's proof (T4758 C1 design pick 7). */
export const HOST_ID_FILE = 'host-id';

const HOST_ID = /^[0-9a-f]{32}$/u;

/** Where the kit home keeps this machine's host id. */
export function hostIdFile(kitHome: string): string {
  return join(kitHome, HOST_ID_FILE);
}

/**
 * This machine's host id as an owner's proof challenge names it: 16 random bytes as 32 lowercase hex, made once and
 * kept under the kit home. A random id rather than the machine's name, so no host name reaches a task line. The
 * create is exclusive and atomic, so of two first runs racing, the loser reads the winner's id. A file that holds
 * anything else is refused, never replaced: a new id would turn down every proof the old one recorded.
 */
export async function readHostId(files: Pick<Files, 'read' | 'createExclusive'>, kitHome: string, newHex: () => string): Promise<string> {
  const path = hostIdFile(kitHome);
  const existing = await files.read(path);
  if (existing !== undefined) {
    return checkedHostId(existing, path);
  }
  const made = newHex();
  if (!HOST_ID.test(made)) {
    throw new Error(`a new host id must be 32 lowercase hex digits, not "${made}"`);
  }
  if (await files.createExclusive(path, `${made}\n`)) {
    return made;
  }
  const winner = await files.read(path);
  if (winner === undefined) {
    throw new Error(`${path} was made by another run and is gone again`);
  }
  return checkedHostId(winner, path);
}

function checkedHostId(text: string, path: string): string {
  const id = text.trim();
  if (!HOST_ID.test(id)) {
    throw new Error(`${path} does not hold a host id (32 lowercase hex digits); fix or remove it by hand`);
  }
  return id;
}
