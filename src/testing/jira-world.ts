import { isRecord, isStringArray, recordField, stringField, type CloseReason, type IssueTarget } from '../plugin-api/index.ts';
import type { TrackerWorld, WorldIssue } from '../conformance/index.ts';
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
 * past the port. Jira's own answers are kept where the contract can see them: an issue it does not hold is Not Found,
 * an account that may not be assigned is refused, and a label exists once an issue carries it. Any other request
 * fails, so a spec sees a call this fake does not know.
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
    const match = new RegExp(`^/issue/${this.key}-([1-9][0-9]*)(/[a-z]+)?(\\?.*)?$`, 'u').exec(path);
    if (match === null) {
      return undefined;
    }
    const issue = this.issues.get(Number(match[1]));
    return issue === undefined ? answered(404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'] }) : this.onIssue(issue, request, match[2] ?? '', match[3] ?? '');
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
          status: issue.done ? { name: 'Done', statusCategory: { key: 'done' } } : { name: 'To Do', statusCategory: { key: 'new' } },
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
