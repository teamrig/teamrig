import { readConnectorSteps, readHostSteps, type Load, type ServedSteps } from '../../composition/loader.ts';
import type { KitConfig } from '../../config/types.ts';
import { STEPS, isStepId, type StepId } from '../../features/steps.ts';
import type { ConnectorDeclaration, HostDeclaration } from '../../plugin-api/index.ts';
import { UsageError, type ParsedArgs } from '../args.ts';
import { hostIdOf } from '../host.ts';
import { openTeamKit, requireConfig } from '../kit.ts';
import { EXIT, type CliRuntime, type ExitCode } from '../runtime.ts';

/** One adapter that may serve a step: its id, the name a reader knows it by, and its text of the step if it has one. */
interface Server {
  readonly id: string;
  readonly name: string;
  readonly text: string | undefined;
}

/** The adapters of one side whose declarations loaded, each with its text of `step`; a refused one is told on stderr. */
function serversOf<D extends HostDeclaration | ConnectorDeclaration>(loads: readonly Load<ServedSteps<D>>[], step: StepId, runtime: CliRuntime): readonly (Server & { readonly declaration: D })[] {
  return loads.flatMap((load) => {
    if (load.kind === 'refused') {
      runtime.out.stderr(`warning: the adapter ${load.id} did not load, so its text of ${step} is not read: ${load.notices.join('; ')}`);
      return [];
    }
    const { declaration, texts } = load.value;
    return [{ id: load.id, name: declaration.name, text: texts.get(step), declaration }];
  });
}

/** The connector ids a team works with: GitHub while it imports any repository, and each section under `connectors`. */
function teamConnectors(config: KitConfig): ReadonlySet<string> {
  return new Set([...(config.github.repos.length > 0 ? ['github'] : []), ...Object.keys(config.connectors)]);
}

/** The connector a ref names by its prefix (`gh:owner/name#12`); a ref no connector's prefix starts is a usage error. */
function connectorOfRef(servers: readonly (Server & { readonly declaration: ConnectorDeclaration })[], ref: string): string {
  const named = servers.find((server) => ref.startsWith(server.declaration.refPrefix));
  if (named === undefined) {
    throw new UsageError(`--for ${ref} starts with no connector's prefix: ${servers.map((server) => server.declaration.refPrefix).join(', ')}`);
  }
  return named.id;
}

/** The lines printed for `step`: each chosen adapter's text headed by its name, else the fallback and who would serve it. */
export function stepLines(step: StepId, chosen: readonly Server[], everyServer: readonly Server[]): readonly string[] {
  const served = chosen.filter((server) => server.text !== undefined);
  if (served.length > 0) {
    return served.flatMap((server, index) => [...(index === 0 ? [] : ['']), `${server.name}:`, server.text ?? '']);
  }
  const would = everyServer.filter((server) => server.text !== undefined).map((server) => server.name);
  const side = STEPS[step].side;
  return [
    `No ${side} adapter in use here serves ${step}${would.length === 0 ? '.' : `; ${would.join(', ')} would.`}`,
    STEPS[step].fallback,
  ];
}

/**
 * `skills step <id> [--for <ref>]`: prints how each adapter in use does one step a skill names, such as
 * `tracker.link-child`. A host step is the running host's; a connector step is the connector `--for`'s ref names
 * by its prefix, else each one the team config uses. With none serving it, the step's neutral fallback.
 */
export async function skillStep(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  const [id, ...extra] = args.positionals;
  if (id === undefined || extra.length > 0) {
    throw new UsageError(`skills step takes one step id: ${Object.keys(STEPS).join(', ')}`);
  }
  if (!isStepId(id)) {
    throw new UsageError(`${id} is no step: the steps are ${Object.keys(STEPS).join(', ')}`);
  }
  const ref = args.flags.get('for');
  if (STEPS[id].side === 'host') {
    if (ref !== undefined) {
      throw new UsageError(`--for picks a connector, and ${id} is a host step`);
    }
    const hosts = serversOf(await readHostSteps(), id, runtime);
    const running = hostIdOf(runtime);
    for (const line of stepLines(id, hosts.filter((host) => host.id === running), hosts)) runtime.out.stdout(line);
    return EXIT.ok;
  }
  const connectors = serversOf(await readConnectorSteps(), id, runtime);
  const inUse = ref === undefined ? teamConnectors(requireConfig(await openTeamKit(runtime), runtime, 'read')) : new Set([connectorOfRef(connectors, ref)]);
  for (const line of stepLines(id, connectors.filter((connector) => inUse.has(connector.id)), connectors)) runtime.out.stdout(line);
  return EXIT.ok;
}
