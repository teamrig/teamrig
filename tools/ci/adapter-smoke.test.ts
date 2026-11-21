import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { BUILT_LOADER, BUILT_TABLES, adapterFindings, builtAdapterSides, type AdapterSide, type FileImporter } from './adapter-smoke.ts';

const ROOT = resolve('/plugin');

/** Answers each id as the built loader would: loaded, unless `refused` names it. */
function side(name: string, ids: readonly string[], refused: Readonly<Record<string, readonly string[]>> = {}): AdapterSide {
  return {
    side: name,
    ids,
    load: (id) => Promise.resolve(Object.hasOwn(refused, id) ? { kind: 'refused', id, notices: refused[id] } : { kind: 'loaded', id, value: {} }),
  };
}

/** An importer over two fixed modules, keyed by the built files' paths; any other path throws as a missing file would. */
function importerOf(loader: unknown, tables: unknown): FileImporter & { readonly paths: string[] } {
  const paths: string[] = [];
  const modules = new Map<string, unknown>([
    [join(ROOT, BUILT_LOADER), loader],
    [join(ROOT, BUILT_TABLES), tables],
  ]);
  const importer = (path: string): Promise<unknown> => {
    paths.push(path);
    return modules.has(path) ? Promise.resolve(modules.get(path)) : Promise.reject(new Error(`Cannot find module '${path}'`));
  };
  return Object.assign(importer, { paths });
}

const loaded = (id: string): Promise<unknown> => Promise.resolve({ kind: 'loaded', id, value: {} });

const LOADER = { loadHost: loaded, loadConnector: loaded, loadTerminal: loaded };
const TABLES = {
  HOST_ADAPTERS: { 'claude-code': '../adapters/hosts/claude-code' },
  CONNECTOR_ADAPTERS: { github: '../adapters/connectors/github', jira: '../adapters/connectors/jira' },
  TERMINAL_ADAPTERS: { tmux: '../adapters/terminals/tmux' },
};

describe('adapterFindings', () => {
  it('finds nothing when every adapter of every side loads', async () => {
    assert.deepEqual(await adapterFindings([side('host', ['claude-code']), side('connector', ['github', 'jira'])]), []);
  });

  it("names each adapter the built loader refuses, with the loader's reasons", async () => {
    const findings = await adapterFindings([side('connector', ['github', 'jira'], { jira: ["its index.ts did not load: Cannot find module 'index.ts'", 'a second reason'] })]);
    assert.deepEqual(findings, ["adapters: the connector adapter jira does not load from the dist: its index.ts did not load: Cannot find module 'index.ts'; a second reason"]);
  });

  it('counts a throw and an answer that reads as no load as a refusal', async () => {
    const throws: AdapterSide = { side: 'host', ids: ['claude-code'], load: () => Promise.reject(new Error('boom')) };
    const odd: AdapterSide = { side: 'terminal', ids: ['tmux', 'konsole'], load: (id) => Promise.resolve(id === 'tmux' ? 'yes' : { kind: 'refused', notices: [7] }) };
    assert.deepEqual(await adapterFindings([throws, odd]), [
      'adapters: the host adapter claude-code does not load from the dist: the loader threw: boom',
      'adapters: the terminal adapter tmux does not load from the dist: the loader answered no load',
      'adapters: the terminal adapter konsole does not load from the dist: the loader answered no load',
    ]);
  });

  it('finds a side whose built table lists no adapter', async () => {
    assert.deepEqual(await adapterFindings([side('host', [])]), ['adapters: the built table lists no host adapter']);
  });
});

describe('builtAdapterSides', () => {
  it("reads the three sides from the plugin's built loader and table, in order", async () => {
    const importer = importerOf(LOADER, TABLES);
    const read = await builtAdapterSides(ROOT, importer);
    assert.ok('sides' in read);
    assert.deepEqual(
      read.sides.map(({ side: name, ids }) => [name, ids]),
      [
        ['host', ['claude-code']],
        ['connector', ['github', 'jira']],
        ['terminal', ['tmux']],
      ],
    );
    assert.deepEqual(importer.paths, [join(ROOT, BUILT_LOADER), join(ROOT, BUILT_TABLES)]);
  });

  it('answers a finding when the built loader is missing', async () => {
    const read = await builtAdapterSides(resolve('/elsewhere'), importerOf(LOADER, TABLES));
    assert.ok('finding' in read);
    assert.match(read.finding, /^adapters: the built loader did not load: Cannot find module/);
  });

  it('answers a finding when a loader export or a table is missing or not folders', async () => {
    const noTerminal = await builtAdapterSides(ROOT, importerOf({ loadHost: loaded, loadConnector: loaded }, TABLES));
    const badTable = await builtAdapterSides(ROOT, importerOf(LOADER, { ...TABLES, HOST_ADAPTERS: { 'claude-code': 1 } }));
    const notModule = await builtAdapterSides(ROOT, importerOf('text', TABLES));
    assert.deepEqual([noTerminal, badTable, notModule], [
      { finding: `adapters: the built ${BUILT_LOADER} has no loadTerminal, or ${BUILT_TABLES} no TERMINAL_ADAPTERS of folders` },
      { finding: `adapters: the built ${BUILT_LOADER} has no loadHost, or ${BUILT_TABLES} no HOST_ADAPTERS of folders` },
      { finding: 'adapters: the built loader or adapter table is not a module' },
    ]);
  });
});
