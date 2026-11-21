import { isRecord } from '../core/guards.ts';
import type { HostAdapter, HostDeps, HostPorts, ProgramRunner } from '../plugin-api/index.ts';
import { HOST_PORT_NAMES, type SessionVariables } from '../ports/host/index.ts';
import { DEFAULT_HOST, HOST_ADAPTERS } from './adapters.ts';
import { importModule, loadHost, type ModuleImporter } from './loader.ts';

/** How long one program a host port runs may take: the limit the process's other system queries run under. */
export const HOST_PROGRAM_TIMEOUT_MS = 30_000;

/**
 * Builds the host ports for the environment and platform one run sees. They are asked for per run, never fixed at
 * load: a spec's world has its own environment, and the adapter must read that one.
 */
export type HostSource = (seen: Pick<HostDeps, 'env' | 'platform'>) => HostPorts;

/**
 * What stops `built` from being every host port; empty when it is. An adapter's `create` is typed, but the type
 * holds only an adapter compiled against this release's ports, so what it built is read as a value.
 */
function portProblems(built: unknown): readonly string[] {
  if (!isRecord(built)) return ['its create function built no ports'];
  return HOST_PORT_NAMES.filter((name) => !isRecord(built[name])).map((name) => `it builds no ${name} port: a port its tool cannot fill is an unsupported(reason)`);
}

/** The ports `adapter` builds from `deps`; one that leaves a port unnamed throws every reason, as a refused load does. */
function build(adapter: HostAdapter, id: string, deps: HostDeps): HostPorts {
  const ports = adapter.create(deps);
  const problems = portProblems(ports);
  if (problems.length > 0) {
    throw new Error(`the host adapter ${id} cannot be used: ${problems.join('; ')}`);
  }
  return ports;
}

/** Loads the host adapter `id`; a refused adapter throws every reason. */
async function adapterOf(id: string, importer: ModuleImporter): Promise<HostAdapter> {
  const load = await loadHost(id, importer);
  if (load.kind === 'refused') {
    throw new Error(`the host adapter ${load.id} did not load: ${load.notices.join('; ')}`);
  }
  return load.value;
}

/** The way to build the ports of `adapter`, loaded as `id`. */
function sourceFrom(adapter: HostAdapter, id: string, run: ProgramRunner): HostSource {
  return (seen) => build(adapter, id, { ...seen, run });
}

/** Loads the host adapter `id` and gives the way to build its ports; a refused adapter throws every reason. */
async function sourceOf(id: string, run: ProgramRunner, importer: ModuleImporter): Promise<HostSource> {
  return sourceFrom(await adapterOf(id, importer), id, run);
}

/**
 * One host adapter teamrig ships with: the way to build its ports, and the session variables its declaration names.
 * The variables are the declaration's own, not its launcher port's: a host whose launcher is not built yet still
 * sets its marks in what its agent runs, and a run that counted only built launchers would take that agent's run
 * for the person's.
 */
export interface ShippedHost {
  readonly ports: HostSource;
  readonly sessionVariables: SessionVariables;
}

/**
 * Loads the host adapter teamrig runs in, once per process, and gives the way to build its ports. A refused
 * adapter throws every reason: no command can do its work without the host, so this is a start failure, not a
 * port the core could word a refusal for.
 */
export function loadHostPorts(run: ProgramRunner, importer: ModuleImporter = importModule): Promise<HostSource> {
  return sourceOf(DEFAULT_HOST, run, importer);
}

/** Every host adapter teamrig ships with, each id beside the way to build its ports. */
export type ShippedHosts = Readonly<Record<string, ShippedHost>>;

/**
 * Loads every host adapter teamrig ships with (`HOST_ADAPTERS`), the one it runs in among them, and gives the way to
 * build each one's ports beside the session variables it declares, by id: for the host a run names (`--host`,
 * src/cli/host-choice.ts), and for what holds on a machine whatever host runs the session, such as the files a host
 * keeps a login in. One that does not load throws every reason, as the running one does: an answer drawn from fewer
 * hosts than ship would be a weaker one, told to nobody.
 */
export async function loadShippedHosts(run: ProgramRunner, importer: ModuleImporter = importModule): Promise<ShippedHosts> {
  const entries = await Promise.all(
    Object.keys(HOST_ADAPTERS).map(async (id) => {
      const adapter = await adapterOf(id, importer);
      return [id, { ports: sourceFrom(adapter, id, run), sessionVariables: adapter.declaration.sessionVariables }] as const;
    }),
  );
  return Object.fromEntries(entries);
}
