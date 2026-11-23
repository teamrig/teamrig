import type { ConfigReport } from '../plugin-api/connector.ts';
import { isRecord, type JsonRecord } from '../core/guards.ts';
import type { ProjectTrust, SiteTrust, TrustEdits, TrustLevel, TrustMatcher } from './trust-rule.ts';

/**
 * Reads a connector's `trust` key (trust-rule.ts) as the team's JSON holds it. Total: a wrong key is reported and
 * reads as if it were left out, so a rule with a mistake in it never widens what the import trusts.
 */

/** What a connector lets its rule name: the account kinds its tracker gives, the shape of an id and of a project key. */
export interface TrustSyntax {
  readonly accountTypes: readonly string[];
  readonly accountId: RegExp;
  /** The project key as the tracker spells it, or undefined for one that is not a key. */
  readonly projectKey: (text: string) => string | undefined;
}

/** The most account ids one matcher names. */
export const MAX_TRUST_ACCOUNTS = 100;

/** The matcher kinds the model has (trust-rule.ts) that no connector reads yet: named so the refusal says "not yet". */
const LATER_KINDS: ReadonlySet<string> = new Set(['groups', 'projectRoles', 'emailDomains', 'anonymous']);

const LEVEL_KEYS: ReadonlySet<string> = new Set(['inside', 'never', 'edits']);
const SITE_KEYS: ReadonlySet<string> = new Set([...LEVEL_KEYS, 'projects']);
const PROJECT_KEYS: ReadonlySet<string> = new Set([...LEVEL_KEYS, 'import']);

/** The rule of a section with no `trust` key: every key takes the connector's default. */
export const NO_TRUST_RULE: SiteTrust = { inside: undefined, never: [], edits: undefined, projects: new Map() };

function shown(value: unknown): string {
  return JSON.stringify(value);
}

function listOf(value: unknown, key: string, report: ConfigReport, check: (entry: string, at: string) => string | undefined): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    report(key, 'must be a list of one or more names');
    return undefined;
  }
  const out: string[] = [];
  let failed = false;
  value.forEach((entry: unknown, index) => {
    const at = `${key}[${index}]`;
    const text = typeof entry === 'string' ? entry.trim() : '';
    const problem = typeof entry === 'string' ? check(text, at) : `must be text, not ${shown(entry)}`;
    if (problem !== undefined) {
      report(at, problem);
      failed = true;
    } else if (out.includes(text)) {
      report(at, `names ${text} a second time`);
    } else {
      out.push(text);
    }
  });
  if (out.length > MAX_TRUST_ACCOUNTS) {
    report(key, `names more than the ${MAX_TRUST_ACCOUNTS} the rule takes`);
    return undefined;
  }
  return failed ? undefined : out;
}

function matcherOf(value: unknown, key: string, syntax: TrustSyntax, report: ConfigReport): TrustMatcher | undefined {
  const kinds = isRecord(value) ? Object.keys(value) : [];
  const kind = kinds[0];
  if (!isRecord(value) || kind === undefined || kinds.length !== 1) {
    report(key, `must be one matcher, {"accountType": [...]} or {"accounts": [...]}, not ${shown(value)}`);
    return undefined;
  }
  if (kind === 'accountType') {
    const types = listOf(value[kind], `${key}.accountType`, report, (entry) =>
      syntax.accountTypes.includes(entry) ? undefined : `must be one of ${syntax.accountTypes.join(', ')}, not ${shown(entry)}`,
    );
    return types === undefined ? undefined : { kind, types };
  }
  if (kind === 'accounts') {
    const ids = listOf(value[kind], `${key}.accounts`, report, (entry) => (syntax.accountId.test(entry) ? undefined : `must be an account id, not ${shown(entry)}`));
    return ids === undefined ? undefined : { kind, ids };
  }
  report(key, LATER_KINDS.has(kind) ? `${kind} is not read by this connector yet; name accountType or accounts` : `has no matcher ${shown(kind)}; name accountType or accounts`);
  return undefined;
}

/**
 * A list of matchers. An `inside` with a wrong entry reads as an empty list (nothing is inside): reading it as left out
 * would fall back to the default, which may be wider than what the team wrote. A wrong `never` entry is dropped alone.
 */
function matchersOf(value: unknown, key: string, syntax: TrustSyntax, report: ConfigReport, widens: boolean): readonly TrustMatcher[] {
  if (!Array.isArray(value)) {
    report(key, 'must be a list of matchers ([{"accountType": ["atlassian"]}])');
    return [];
  }
  const matchers = value.map((entry: unknown, index) => matcherOf(entry, `${key}[${index}]`, syntax, report));
  const read = matchers.flatMap((matcher) => (matcher === undefined ? [] : [matcher]));
  return widens && read.length !== matchers.length ? [] : read;
}

function editsOf(value: unknown, key: string, report: ConfigReport): TrustEdits | undefined {
  if (value === undefined || value === 'inside' || value === 'any') {
    return value;
  }
  report(key, `must be "inside" or "any", not ${shown(value)}`);
  return 'inside';
}

function unknownKeys(value: JsonRecord, known: ReadonlySet<string>, key: string, report: ConfigReport): void {
  for (const name of Object.keys(value)) {
    if (name === 'accept') {
      report(`${key}.accept`, 'is not read yet: an outsider issue imports only by inside, so drop the key');
    } else if (!known.has(name)) {
      report(`${key}.${name}`, 'is no key of a trust rule (inside, never, edits, projects, import)');
    }
  }
}

function levelOf(value: JsonRecord, key: string, syntax: TrustSyntax, report: ConfigReport): TrustLevel {
  return {
    inside: value['inside'] === undefined ? undefined : matchersOf(value['inside'], `${key}.inside`, syntax, report, true),
    never: value['never'] === undefined ? [] : matchersOf(value['never'], `${key}.never`, syntax, report, false),
    edits: editsOf(value['edits'], `${key}.edits`, report),
  };
}

function projectOf(value: unknown, key: string, syntax: TrustSyntax, report: ConfigReport): ProjectTrust | undefined {
  if (!isRecord(value)) {
    report(key, `must be an object of a project's own rule, not ${shown(value)}`);
    return undefined;
  }
  unknownKeys(value, PROJECT_KEYS, key, report);
  const take = value['import'];
  if (take !== undefined && typeof take !== 'boolean') {
    report(`${key}.import`, `must be true or false, not ${shown(take)}`);
  }
  return { ...levelOf(value, key, syntax, report), import: take === undefined || take === true };
}

function projectsOf(value: unknown, key: string, syntax: TrustSyntax, report: ConfigReport): ReadonlyMap<string, ProjectTrust> {
  const projects = new Map<string, ProjectTrust>();
  if (value === undefined) {
    return projects;
  }
  if (!isRecord(value)) {
    report(key, 'must be an object of project keys to their own rule ({"ENG": {"import": false}})');
    return projects;
  }
  for (const [name, rule] of Object.entries(value)) {
    const project = syntax.projectKey(name.trim());
    const read = project === undefined ? undefined : projectOf(rule, `${key}.${project}`, syntax, report);
    if (project === undefined) {
      report(`${key}.${name}`, `must be a project key, not ${shown(name)}`);
    } else if (read !== undefined) {
      projects.set(project, read);
    }
  }
  return projects;
}

/** The rule a connector section's `trust` value holds, `key` naming it in each report line. */
export function parseTrustRule(value: unknown, key: string, syntax: TrustSyntax, report: ConfigReport): SiteTrust {
  if (value === undefined) {
    return NO_TRUST_RULE;
  }
  if (!isRecord(value)) {
    report(key, `must be an object (inside, never, edits, projects), not ${shown(value)}`);
    return { ...NO_TRUST_RULE, inside: [] };
  }
  unknownKeys(value, SITE_KEYS, key, report);
  return { ...levelOf(value, key, syntax, report), projects: projectsOf(value['projects'], `${key}.projects`, syntax, report) };
}
