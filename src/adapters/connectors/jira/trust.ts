import {
  isRecord,
  judgeTrust,
  recordField,
  stringField,
  type JsonRecord,
  type ResolvedTrust,
  type TrustAuthor,
  type TrustDefaults,
  type TrustEditors,
  type TrustVerdict,
} from '../../../plugin-api/index.ts';
import type { JiraClient } from './client.ts';
import type { JiraProject } from './site.ts';

/**
 * The facts the core's trust rule (sync/trust-rule.ts) judges a Jira issue on: its reporter's account id and kind, and,
 * when the rule asks it, who edited its summary or description, read from the issue's whole changelog. A history that
 * cannot be read whole (a failed, capped or unreadable page) is no history: the rule takes no decision on part of it.
 */

/** Left unset, a site account is inside and an edit by anyone else drops the issue's trust. */
export const JIRA_TRUST_DEFAULTS: TrustDefaults = { inside: [{ kind: 'accountType', types: ['atlassian'] }], edits: 'inside' };

/** The changes one read of a changelog asks for: the most Jira gives at once. */
export const CHANGELOG_PAGE = 100;

/** The pages of one changelog read at most, so an issue edited without end cannot hold a run; past it the history is unread. */
export const MAX_CHANGELOG_PAGES = 10;

/** The fields whose change is an edit of the text the import takes. */
const EDITED_FIELDS: ReadonlySet<string> = new Set(['summary', 'description']);

/** The config key a team sets to let its people in on `project` when the default is held back. */
export function insideKey(project: JiraProject): string {
  return `connectors.jira.trust.projects.${project.key}.inside`;
}

/** How the public-project guard read a project: proved closed to a reader with no sign-in, or open, with what it was given. */
export type Exposure = { readonly kind: 'closed' } | { readonly kind: 'open'; readonly given: string };

/**
 * The only answers that prove an unsigned read was turned away. Anything else (200, a redirect, a 429 or 5xx, no
 * answer at all) is no proof, so the project counts as one anyone may browse and the default inside is held back.
 */
const CLOSED_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

/**
 * Whether anyone may browse `project`: one read of it with no credentials. A project open to the public may take issues
 * from people the team never let in, so there the default inside waits for the team to name who is inside.
 */
export async function exposureOf(client: JiraClient, project: JiraProject): Promise<Exposure> {
  const result = await client.unsigned(project.site, `/project/${project.key}`);
  if (result.kind === 'failed') {
    return { kind: 'open', given: 'got no answer' };
  }
  return CLOSED_STATUSES.has(result.status) ? { kind: 'closed' } : { kind: 'open', given: `was answered ${result.status}` };
}

/** The one line a list prints for a project the guard found open, naming the key that lets the team's people in. */
export function openProjectLine(project: JiraProject, exposure: Exposure & { readonly kind: 'open' }): string {
  return `anyone may browse ${project.key}: its read without a sign-in ${exposure.given}, so the default inside is not applied; set ${insideKey(project)}`;
}

/** A Jira user as the rule reads it, or undefined for none; an account id Jira hides reads as empty, which is never inside. */
export function trustAuthor(user: JsonRecord | undefined): TrustAuthor | undefined {
  return user === undefined ? undefined : { accountId: stringField(user, 'accountId') ?? '', accountType: stringField(user, 'accountType') };
}

/** The reporter of one issue as a search or a bulk read gives it. */
export function reporterOf(value: unknown): TrustAuthor | undefined {
  const fields = isRecord(value) ? recordField(value, 'fields') : undefined;
  return trustAuthor(fields === undefined ? undefined : recordField(fields, 'reporter'));
}

/** Who edited the summary or description in one page of changes, or undefined when the page does not read as changes. */
function pageEditors(values: readonly unknown[]): TrustAuthor[] | undefined {
  const editors: TrustAuthor[] = [];
  for (const change of values) {
    const items: unknown = isRecord(change) ? change['items'] : undefined;
    if (!isRecord(change) || !Array.isArray(items)) {
      return undefined;
    }
    const edits = items.some((item: unknown) => isRecord(item) && EDITED_FIELDS.has(stringField(item, 'fieldId') ?? stringField(item, 'field') ?? ''));
    if (edits) {
      editors.push(trustAuthor(recordField(change, 'author')) ?? { accountId: '', accountType: undefined });
    }
  }
  return editors;
}

function unread(why: string): TrustEditors {
  return { kind: 'unread', why };
}

/** Whether a changelog page is its last: Jira says so, or the changes read reach its total, or the page is empty. */
function lastPage(body: JsonRecord, read: number, given: number): boolean {
  const total = body['total'];
  return body['isLast'] === true || given === 0 || (typeof total === 'number' && read >= total);
}

/** Who edited the summary or description of `key`, from its whole changelog, page after page. */
export async function readEditors(client: JiraClient, project: JiraProject, key: string): Promise<TrustEditors> {
  const editors: TrustAuthor[] = [];
  let startAt = 0;
  for (let page = 0; page < MAX_CHANGELOG_PAGES; page += 1) {
    const answer = await client.get(project.site, `/issue/${key}/changelog?startAt=${startAt}&maxResults=${CHANGELOG_PAGE}`);
    if (answer.kind !== 'ok') {
      return unread(answer.kind === 'missing' ? `Jira gave no edit history of ${key}` : `the read of ${key}'s edit history failed: ${answer.reason}`);
    }
    const values: unknown = isRecord(answer.body) ? answer.body['values'] : undefined;
    const read = Array.isArray(values) ? pageEditors(values) : undefined;
    if (!isRecord(answer.body) || !Array.isArray(values) || read === undefined) {
      return unread(`Jira's answer for ${key}'s edit history did not read as a list of changes`);
    }
    editors.push(...read);
    startAt += values.length;
    if (lastPage(answer.body, startAt, values.length)) {
      return { kind: 'read', editors };
    }
  }
  return unread(`${key}'s edit history runs past the ${MAX_CHANGELOG_PAGES * CHANGELOG_PAGE} changes one read takes`);
}

/**
 * The rule's verdict on issue `key` reported by `reporter`. The changelog is read only when the rule would trust the
 * issue and asks edits to be inside's, so an outsider's issue costs no request.
 */
export async function judgeIssue(client: JiraClient, rule: ResolvedTrust, project: JiraProject, key: string, reporter: TrustAuthor | undefined): Promise<TrustVerdict> {
  const unedited = judgeTrust(rule, { author: reporter, editors: { kind: 'read', editors: [] } });
  if (!unedited.trusted || rule.edits !== 'inside') {
    return unedited;
  }
  return judgeTrust(rule, { author: reporter, editors: await readEditors(client, project, key) });
}
