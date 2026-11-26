import { isRecord, isStringArray, recordField, stringField, type CloseReason, type IssueTarget } from '../plugin-api/index.ts';
import type { Filing, TrackerReadsWorld, TrackerWorld, WorldIssue } from '../conformance/index.ts';
import type { HttpClient, HttpRequest, HttpResult } from '../core/http.ts';

/** One issue as Jira holds it, its description and comments as the text their documents read as. */
interface JiraIssue {
  readonly summary: string;
  description: string;
  done: boolean;
  /** The id of the resolution it was closed with; undefined while open, or closed with none. */
  resolution: string | undefined;
  labels: string[];
  assignee: string | null;
  readonly comments: string[];
}

/** The type every issue of the project opens as. */
const TASK = { id: '10001', name: 'Task', subtask: false };

/** The one closing transition of the project's workflow, from any status, and the resolutions its screen offers. */
const CLOSE_TRANSITION = '31';
const RESOLUTIONS: ReadonlyMap<string, { readonly name: string; readonly reason: CloseReason }> = new Map([
  ['1', { name: 'Done', reason: 'completed' }],
  ['2', { name: "Won't Do", reason: 'not-planned' }],
]);

function answered(status: number, body?: unknown): HttpResult {
  return { kind: 'answered', status, headers: {}, body: body === undefined ? '' : JSON.stringify(body) };
}

/**
 * The plain text of a document as the tracker writes one, read here on its own rather than by the adapter's reader:
 * its paragraphs a blank line apart, a hard break a new line.
 */
function docText(doc: unknown): string | undefined {
  const content: unknown = isRecord(doc) && doc['type'] === 'doc' ? doc['content'] : undefined;
  if (!Array.isArray(content)) {
    return undefined;
  }
  return content
    .map((paragraph: unknown) => {
      const inline: unknown = isRecord(paragraph) ? paragraph['content'] : undefined;
      return (Array.isArray(inline) ? inline : []).map((node: unknown) => (isRecord(node) ? (node['type'] === 'hardBreak' ? '\n' : (stringField(node, 'text') ?? '')) : '')).join('');
    })
    .join('\n\n');
}

/** A text as Jira gives a description back: a document of one paragraph per blank-line-apart block, null when empty. */
function docOf(text: string): unknown {
  if (text === '') {
    return null;
  }
  const paragraph = (block: string): unknown => ({
    type: 'paragraph',
    content: block.split('\n').flatMap((line, at) => [...(at === 0 ? [] : [{ type: 'hardBreak' }]), ...(line === '' ? [] : [{ type: 'text', text: line }])]),
  });
  return { type: 'doc', version: 1, content: text.split('\n\n').map(paragraph) };
}

/** The status Jira gives an issue, done or not, as both a read of it and a search answer carry it. */
function statusOf(done: boolean): unknown {
  return done ? { name: 'Done', statusCategory: { key: 'done' } } : { name: 'To Do', statusCategory: { key: 'new' } };
}

/**
 * A search's JQL as the Jira connector sends one for words: `project = "<key>" AND text ~ "<words>"`, then a clause
 * keeping it to open (`statusCategory != Done`) or closed (`statusCategory = Done`) issues, or none for both.
 */
const TEXT_SEARCH = /^project = "([^"\\]+)" AND text ~ "((?:[^"\\]|\\.)*)"(?: AND statusCategory (!=|=) Done)?$/u;

interface TextSearch {
  readonly key: string;
  readonly words: readonly string[];
  /** Whether it keeps to done issues, to the rest, or undefined for both. */
  readonly done: boolean | undefined;
  readonly maxResults: number;
}

/** The text search a `/search/jql` body asks for; undefined for any other search, which this fake does not read. */
function textSearch(body: unknown): TextSearch | undefined {
  const jql = isRecord(body) ? stringField(body, 'jql') : undefined;
  const maxResults: unknown = isRecord(body) ? body['maxResults'] : undefined;
  const parts = TEXT_SEARCH.exec(jql ?? '');
  if (parts === null || typeof maxResults !== 'number') {
    return undefined;
  }
  const [, key = '', quoted = '', clause] = parts;
  return {
    key,
    words: quoted
      .replace(/\\(.)/gu, '$1')
      .toLowerCase()
      .split(/\s+/u)
      .filter((word) => word !== ''),
    done: clause === undefined ? undefined : clause === '=',
    maxResults,
  };
}

function parsed(request: HttpRequest): unknown {
  if (request.method === 'GET' || request.body === undefined) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(request.body);
    return value;
  } catch {
    return undefined;
  }
}

/**
 * One Jira Cloud project, faked behind its REST API as the Jira connector calls it: open an issue, comment on it,
 * replace its description, close it by its workflow's transition, change its labels and its one assignee, and read
 * what those need first. It holds what those requests change, as Jira does, so the tracker contract reads the result
 * past the port. It also answers the reads: one issue with its summary and description, and a text search of the
 * project, one page at a time. Jira's own answers are kept where the contracts can see them: an issue it does not
 * hold is Not Found, an account that may not be assigned is refused, a label exists once an issue carries it, and a
 * search past one page gives a next page's token. Any other request fails, so a spec sees a call this fake does not
 * know.
 */
export class JiraWorld implements HttpClient {
  /** Every request sent, in order. */
  readonly requests: HttpRequest[] = [];
  /** The tracker's place of the project, `<site>/<key>` as the port names it. */
  readonly repo: string;
  private readonly api: string;
  private readonly key: string;
  private readonly issues = new Map<number, JiraIssue>();
  private readonly people = new Set<string>();
  private last = 0;

  constructor(site: string, key: string) {
    this.api = `https://${site}.atlassian.net/rest/api/3`;
    this.key = key;
    this.repo = `${site}/${key.toLowerCase()}`;
  }

  send(request: HttpRequest): Promise<HttpResult> {
    this.requests.push(request);
    return Promise.resolve(this.answer(request) ?? { kind: 'failed', reason: `the fake Jira does not know ${request.method} ${request.url}` });
  }

  /** The tracker contract's view of this project. */
  world(): TrackerWorld {
    return {
      repo: this.repo,
      fileByHand: (title, body) => this.file(title, body, []),
      // A Jira label is made by the first issue that carries it, so there is nothing to make ahead.
      makeLabel: () => undefined,
      addPerson: (login) => {
        this.people.add(login);
      },
      issue: (target): WorldIssue | undefined => {
        const held = target.repo === this.repo ? this.issues.get(target.number) : undefined;
        if (held === undefined) {
          return undefined;
        }
        return {
          title: held.summary,
          body: held.description,
          state: held.done ? 'closed' : 'open',
          reason: held.resolution === undefined ? undefined : RESOLUTIONS.get(held.resolution)?.reason,
          labels: [...held.labels],
          assignees: held.assignee === null ? [] : [held.assignee],
          comments: [...held.comments],
        };
      },
    };
  }

  /**
   * The tracker reads contract's view of this project: issues a person files by hand, in any state. A Jira issue
   * holds one assignee, so a filing naming more is refused here rather than read back as less.
   */
  readsWorld(): TrackerReadsWorld {
    return {
      repo: this.repo,
      file: (filing: Filing) => {
        const assignees = filing.assignees ?? [];
        if (assignees.length > 1) {
          throw new Error('a Jira issue holds one assignee, so the fake Jira files none with more');
        }
        const target = this.file(filing.title, filing.body, filing.labels ?? []);
        const held = this.issues.get(target.number);
        if (held !== undefined) {
          held.assignee = assignees[0] ?? null;
          if (filing.state === 'closed') {
            held.done = true;
            held.resolution = '1';
          }
        }
        return target;
      },
    };
  }

  private file(summary: string, description: string, labels: readonly string[]): IssueTarget {
    this.last += 1;
    this.issues.set(this.last, { summary, description, done: false, resolution: undefined, labels: [...labels], assignee: null, comments: [] });
    return { repo: this.repo, number: this.last };
  }

  private answer(request: HttpRequest): HttpResult | undefined {
    if (!request.url.startsWith(this.api)) {
      return undefined;
    }
    const path = request.url.slice(this.api.length);
    if (request.method === 'GET' && path === `/issue/createmeta/${this.key}/issuetypes`) {
      return answered(200, { issueTypes: [TASK] });
    }
    if (request.method === 'POST' && path === '/issue') {
      return this.open(parsed(request));
    }
    if (request.method === 'POST' && path === '/search/jql') {
      const asked = textSearch(parsed(request));
      return asked === undefined ? undefined : this.search(asked);
    }
    const match = new RegExp(`^/issue/${this.key}-([1-9][0-9]*)(/[a-z]+)?(\\?.*)?$`, 'u').exec(path);
    if (match === null) {
      return undefined;
    }
    const issue = this.issues.get(Number(match[1]));
    return issue === undefined ? answered(404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'] }) : this.onIssue(issue, request, match[2] ?? '', match[3] ?? '');
  }

  /**
   * The first page of Jira's text search: the issues whose summary or description holds every word, case aside,
   * oldest first; a next page's token when more match than the page holds.
   */
  private search(asked: TextSearch): HttpResult {
    const matches =
      asked.key !== this.key
        ? []
        : [...this.issues].filter(([, issue]) => (asked.done === undefined || issue.done === asked.done) && asked.words.every((word) => `${issue.summary}\n${issue.description}`.toLowerCase().includes(word)));
    const more = matches.length > asked.maxResults;
    return answered(200, {
      issues: matches.slice(0, asked.maxResults).map(([number, issue]) => ({ key: `${this.key}-${String(number)}`, fields: { summary: issue.summary, status: statusOf(issue.done) } })),
      isLast: !more,
      ...(more ? { nextPageToken: 'page-2' } : {}),
    });
  }

  private open(body: unknown): HttpResult {
    const fields = isRecord(body) ? recordField(body, 'fields') : undefined;
    const summary = fields === undefined ? undefined : stringField(fields, 'summary');
    const project = fields === undefined ? undefined : recordField(fields, 'project');
    const labels: unknown = fields?.['labels'] ?? [];
    const description = fields?.['description'] === undefined ? '' : docText(fields['description']);
    if (summary === undefined || project === undefined || stringField(project, 'key') !== this.key || !isStringArray(labels) || description === undefined) {
      return answered(400, { errorMessages: ['the fake Jira cannot read this issue'] });
    }
    const target = this.file(summary, description, labels);
    return answered(201, { id: String(10000 + target.number), key: `${this.key}-${String(target.number)}` });
  }

  /** A request on one held issue, by the rest of its path and its query. */
  private onIssue(issue: JiraIssue, request: HttpRequest, rest: string, query: string): HttpResult | undefined {
    const body = parsed(request);
    if (request.method === 'GET' && rest === '') {
      return answered(200, {
        fields: {
          summary: issue.summary,
          description: docOf(issue.description),
          status: statusOf(issue.done),
          assignee: issue.assignee === null ? null : { accountId: issue.assignee },
          labels: issue.labels,
        },
      });
    }
    if (request.method === 'GET' && rest === '/transitions' && query === '?expand=transitions.fields') {
      const allowedValues = [...RESOLUTIONS].map(([id, resolution]) => ({ id, name: resolution.name }));
      return answered(200, {
        transitions: [
          { id: '11', name: 'Start', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
          { id: CLOSE_TRANSITION, name: 'Close', to: { name: 'Closed', statusCategory: { key: 'done' } }, fields: { resolution: { required: false, allowedValues } } },
        ],
      });
    }
    if (request.method === 'POST' && rest === '/transitions') {
      return this.transition(issue, body);
    }
    if (request.method === 'POST' && rest === '/comment') {
      const text = isRecord(body) ? docText(body['body']) : undefined;
      if (text === undefined) {
        return undefined;
      }
      issue.comments.push(text);
      return answered(201, { id: '1' });
    }
    if (request.method === 'PUT' && rest === '') {
      return this.edit(issue, body);
    }
    if (request.method === 'PUT' && rest === '/assignee') {
      const account: unknown = isRecord(body) ? body['accountId'] : undefined;
      if (account !== null && (typeof account !== 'string' || !this.people.has(account))) {
        return answered(400, { errorMessages: ['the account may not be assigned'] });
      }
      issue.assignee = account;
      return answered(204);
    }
    return undefined;
  }

  private transition(issue: JiraIssue, body: unknown): HttpResult | undefined {
    const id = isRecord(body) ? stringField(recordField(body, 'transition') ?? {}, 'id') : undefined;
    if (id !== CLOSE_TRANSITION || !isRecord(body)) {
      return undefined;
    }
    const resolution = stringField(recordField(recordField(body, 'fields') ?? {}, 'resolution') ?? {}, 'id');
    if (resolution !== undefined && !RESOLUTIONS.has(resolution)) {
      return answered(400, { errorMessages: ['no such resolution'] });
    }
    issue.done = true;
    issue.resolution = resolution;
    return answered(204);
  }

  private edit(issue: JiraIssue, body: unknown): HttpResult | undefined {
    const fields = isRecord(body) ? recordField(body, 'fields') : undefined;
    const update = isRecord(body) ? recordField(body, 'update') : undefined;
    if (fields !== undefined) {
      const description = docText(fields['description']);
      if (description === undefined) {
        return undefined;
      }
      issue.description = description;
      return answered(204);
    }
    const changes: unknown = update?.['labels'];
    if (!Array.isArray(changes)) {
      return undefined;
    }
    for (const change of changes) {
      const add = isRecord(change) ? stringField(change, 'add') : undefined;
      const remove = isRecord(change) ? stringField(change, 'remove') : undefined;
      if (add !== undefined && !issue.labels.includes(add)) {
        issue.labels.push(add);
      }
      if (remove !== undefined) {
        issue.labels = issue.labels.filter((label) => label !== remove);
      }
    }
    return answered(204);
  }
}
