import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isRecord, type JsonRecord } from '../lib/guards.ts';

/**
 * The dist smoke's adapter step: loads every adapter of the built plugin's tables through the built loader, the way an
 * installed copy reaches one. The loader imports an adapter by a specifier it builds at run time, which no type check
 * or bundle step follows, so a dist that cannot load one shows only here or in a live run.
 */

/** Loads one module by its file path. */
export type FileImporter = (path: string) => Promise<unknown>;

export const importFile: FileImporter = (path) => import(pathToFileURL(path).href);

/** Loads one adapter by its id; the answer is the built loader's, so it is read as unknown. */
export type IdLoader = (id: string) => Promise<unknown>;

/** One side of the adapter tables: its ids and the built loader's function for it. */
export interface AdapterSide {
  readonly side: string;
  readonly ids: readonly string[];
  readonly load: IdLoader;
}

/** The built loader's file and the built table's file, under the plugin folder. */
export const BUILT_LOADER = join('dist', 'composition', 'loader.js');
export const BUILT_TABLES = join('dist', 'composition', 'adapters.js');

/** Each side: the loader's export that loads one, and the table's export that names them. */
const SIDES = [
  { side: 'host', loader: 'loadHost', table: 'HOST_ADAPTERS' },
  { side: 'connector', loader: 'loadConnector', table: 'CONNECTOR_ADAPTERS' },
  { side: 'terminal', loader: 'loadTerminal', table: 'TERMINAL_ADAPTERS' },
] as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isIdLoader(value: unknown): value is IdLoader {
  return typeof value === 'function';
}

/** The ids of a built table: its keys, when every value is a folder specifier. */
function tableIds(value: unknown): readonly string[] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return Object.values(value).every((folder) => typeof folder === 'string') ? Object.keys(value) : undefined;
}

/** The built loader's sides, or the finding that says why they cannot be read. */
export async function builtAdapterSides(pluginRoot: string, importer: FileImporter = importFile): Promise<{ readonly sides: readonly AdapterSide[] } | { readonly finding: string }> {
  let loader: unknown;
  let tables: unknown;
  try {
    [loader, tables] = await Promise.all([importer(join(pluginRoot, BUILT_LOADER)), importer(join(pluginRoot, BUILT_TABLES))]);
  } catch (error) {
    return { finding: `adapters: the built loader did not load: ${messageOf(error)}` };
  }
  if (!isRecord(loader) || !isRecord(tables)) {
    return { finding: 'adapters: the built loader or adapter table is not a module' };
  }
  const sides: AdapterSide[] = [];
  for (const { side, loader: loaderName, table } of SIDES) {
    const load = loader[loaderName];
    const ids = tableIds(tables[table]);
    if (!isIdLoader(load) || ids === undefined) {
      return { finding: `adapters: the built ${BUILT_LOADER} has no ${loaderName}, or ${BUILT_TABLES} no ${table} of folders` };
    }
    sides.push({ side, ids, load });
  }
  return { sides };
}

/** Why one load answer is not a load: the loader's notices, or that the answer reads as neither. */
function refusal(answer: unknown): string | undefined {
  if (!isRecord(answer)) {
    return 'the loader answered no load';
  }
  if (answer['kind'] === 'loaded') {
    return undefined;
  }
  return noticesOf(answer) ?? 'the loader answered no load';
}

function noticesOf(answer: JsonRecord): string | undefined {
  const notices = answer['notices'];
  return answer['kind'] === 'refused' && Array.isArray(notices) && notices.every((notice) => typeof notice === 'string') ? notices.join('; ') : undefined;
}

/** Loads each adapter of each side; returns what is wrong, empty when every one loads. A side with no adapter is wrong too. */
export async function adapterFindings(sides: readonly AdapterSide[]): Promise<string[]> {
  const findings: string[] = [];
  for (const { side, ids, load } of sides) {
    if (ids.length === 0) {
      findings.push(`adapters: the built table lists no ${side} adapter`);
    }
    for (const id of ids) {
      let answer: unknown;
      try {
        answer = await load(id);
      } catch (error) {
        answer = { kind: 'refused', notices: [`the loader threw: ${messageOf(error)}`] };
      }
      const why = refusal(answer);
      if (why !== undefined) {
        findings.push(`adapters: the ${side} adapter ${id} does not load from the dist: ${why}`);
      }
    }
  }
  return findings;
}
