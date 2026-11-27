import type { KitConfig } from '../config/types.ts';
import type { ConnectorDeclaration } from '../plugin-api/index.ts';
import type { LevelNames } from '../register/level-names.ts';
import { importModule, readDeclarations, type ModuleImporter } from './loader.ts';

/** The connector ids a team works with: GitHub while it imports any repository, and each section under `connectors`. */
export function teamConnectors(config: KitConfig): ReadonlySet<string> {
  return new Set([...(config.github.repos.length > 0 ? ['github'] : []), ...Object.keys(config.connectors)]);
}

/**
 * The level names `levels.names: auto` shows: those of the one tracker in use that declares them. Null when none
 * does, and when several do, as no one tracker's words then fit all the team's work: the team sees the default set
 * until it names a preset or its own map.
 */
export function trackerLevelNames(declarations: readonly ConnectorDeclaration[], inUse: ReadonlySet<string>): LevelNames | null {
  const named = declarations.flatMap((declaration) =>
    inUse.has(declaration.id) && declaration.kinds.includes('tracker') && declaration.levelNames !== undefined ? [declaration.levelNames] : [],
  );
  const [only, ...more] = named;
  return only !== undefined && more.length === 0 ? only : null;
}

/** trackerLevelNames of the team's connectors, read from each adapter's declaration; one that does not load names none. */
export async function connectorLevelNames(config: KitConfig, importer: ModuleImporter = importModule): Promise<LevelNames | null> {
  const { connectors } = await readDeclarations(importer);
  const loaded = connectors.flatMap((load) => (load.kind === 'loaded' ? [load.value] : []));
  return trackerLevelNames(loaded, teamConnectors(config));
}
