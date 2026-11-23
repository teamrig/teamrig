import { isStringArray, parseTrustRule, type ConfigReport, type JsonRecord, type SiteTrust, type TrustSyntax } from '../../../plugin-api/index.ts';
import { isSite, projectKey } from './site.ts';

/**
 * The Jira connector's section of the team config (`connectors.jira`): which site the team's issues live on, which
 * of its projects the team works in, the type a new issue opens as, and the accounts that count as the team's people
 * for the import scope. Every key may be left out.
 */
export interface JiraConfig {
  /** The site's name, the part before `.atlassian.net`, in lowercase; undefined while the section names none. */
  readonly site: string | undefined;
  /** The keys of the site's projects the team works in, as Jira spells them, each once. */
  readonly projects: readonly string[];
  /** The name of the type a new issue opens as; undefined for the connector's own pick (issue-type.ts). */
  readonly issueType: string | undefined;
  /**
   * The Jira account ids, each once, whose issues the import takes beside the signed-in account's own
   * (`sync.scope.assigned` = `team`): Jira users have no login, so the team's people are named by account id.
   */
  readonly people: readonly string[];
  /**
   * Whose issues become tasks as written: the site's rule and each project's own (sync/trust-rule.ts). Left out, a
   * site account (accountType atlassian) is inside on a project anonymous users cannot browse.
   */
  readonly trust: SiteTrust;
}

/** The section's keys, each beside the line the declaration says of it. */
export const CONFIG_KEYS = {
  site: "the Jira Cloud site's name, the part before .atlassian.net",
  projects: "the keys of the site's projects the team works in, as Jira spells them (ENG)",
  issueType: "the issue type a new issue opens as; without it a Task, or the project's first type that is no sub-task",
  people: "the account ids whose issues the import takes beside the signed-in account's own (sync.scope.assigned team)",
  trust: 'whose issues become tasks as written: inside, never and edits for the site, and projects for one project',
} as const;

/** The account kinds Jira gives a reporter; a reporter with none is anonymous. */
export const ACCOUNT_TYPES = ['atlassian', 'customer', 'app'] as const;

/**
 * A Jira Cloud account id: letters, digits, `:`, `_` and `-` (`5b10ac8d82e05b22cc7d4ef5`, `712020:2f6e…`). Held to
 * that shape, an id can be quoted into a search with nothing in it Jira would read as syntax.
 */
const ACCOUNT_ID = /^[A-Za-z0-9:_-]{1,128}$/;

/** What a Jira trust rule may name: its account kinds, ids and project keys. */
const TRUST_SYNTAX: TrustSyntax = { accountTypes: ACCOUNT_TYPES, accountId: ACCOUNT_ID, projectKey };

/** The most account ids the section names, so a search's assignee clause stays a size Jira takes. */
export const MAX_PEOPLE = 100;

function shown(value: unknown): string {
  return JSON.stringify(value);
}

function siteOf(value: unknown, report: ConfigReport): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (isSite(name)) {
    return name;
  }
  report('site', `must be the site's name, the part before .atlassian.net (acme for acme.atlassian.net), not ${shown(value)}`);
  return undefined;
}

function projectsOf(value: unknown, report: ConfigReport): readonly string[] {
  if (value === undefined) {
    return [];
  }
  if (!isStringArray(value)) {
    report('projects', 'must be a list of project keys, as Jira spells them (["ENG"])');
    return [];
  }
  const keys: string[] = [];
  value.forEach((entry, index) => {
    const key = projectKey(entry.trim());
    if (key === undefined) {
      report(`projects[${index}]`, `must be a project key, a letter then letters, digits or _ (ENG), not ${shown(entry)}`);
    } else if (keys.includes(key)) {
      report(`projects[${index}]`, `names ${key} a second time`);
    } else {
      keys.push(key);
    }
  });
  return keys;
}

function issueTypeOf(value: unknown, report: ConfigReport): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const name = typeof value === 'string' ? value.trim() : '';
  if (name !== '' && !/[\r\n]/.test(name)) {
    return name;
  }
  report('issueType', `must be the name of an issue type on one line, as the project lists it (Task), not ${shown(value)}`);
  return undefined;
}

function peopleOf(value: unknown, report: ConfigReport): readonly string[] {
  if (value === undefined) {
    return [];
  }
  if (!isStringArray(value)) {
    report('people', 'must be a list of Jira account ids (["5b10ac8d82e05b22cc7d4ef5"])');
    return [];
  }
  const ids: string[] = [];
  value.forEach((entry, index) => {
    const id = entry.trim();
    if (!ACCOUNT_ID.test(id)) {
      report(`people[${index}]`, `must be a Jira account id, letters, digits, :, _ or - (5b10ac8d82e05b22cc7d4ef5), not ${shown(entry)}`);
    } else if (ids.includes(id)) {
      report(`people[${index}]`, `names ${id} a second time`);
    } else if (ids.length === MAX_PEOPLE) {
      report(`people[${index}]`, `is past the ${MAX_PEOPLE} account ids the section may name`);
    } else {
      ids.push(id);
    }
  });
  return ids;
}

/**
 * Reads the section as the team's JSON holds it. Total: a wrong key is reported and reads as if it were left out.
 * A project is named by its key alone, so a section that lists projects and no site is reported too: nothing says
 * where they live.
 */
export function parseJiraConfig(section: JsonRecord, report: ConfigReport): JiraConfig {
  const site = siteOf(section['site'], report);
  const projects = projectsOf(section['projects'], report);
  if (section['site'] === undefined && projects.length > 0) {
    report('site', 'must name the site its projects live on');
  }
  return {
    site,
    projects,
    issueType: issueTypeOf(section['issueType'], report),
    people: peopleOf(section['people'], report),
    trust: parseTrustRule(section['trust'], 'trust', TRUST_SYNTAX, report),
  };
}
