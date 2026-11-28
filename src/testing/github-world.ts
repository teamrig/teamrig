import type { CloseReason, IssueTarget } from '../plugin-api/index.ts';
import type { Filing, TrackerReadsWorld, TrackerWorld, WorldIssue } from '../conformance/index.ts';
import type { GhRequest, GhResult, GhRunner } from '../adapters/connectors/github/gh.ts';

/** One issue as the GitHub REST API holds it. */
interface GitHubIssue {
  readonly title: string;
  body: string;
  state: 'open' | 'closed';
  /** GitHub's own word (`completed`, `not_planned`, `duplicate`); null while open. */
  stateReason: string | null;
  labels: string[];
  assignees: string[];
  readonly comments: string[];
}

/** The port's word for each `state_reason` GitHub keeps on a closed issue. */
const REASON_OF: ReadonlyMap<string, CloseReason> = new Map([
  ['completed', 'completed'],
  ['not_planned', 'not-planned'],
  ['duplicate', 'duplicate'],
]);

const NOT_FOUND: GhResult = { end: { kind: 'exited', code: 1 }, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };

function ok(body: unknown = {}): GhResult {
  return { end: { kind: 'exited', code: 0 }, stdout: JSON.stringify(body), stderr: '' };
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * The fields a JSON request body on stdin holds, as `gh api --input -` sends it: a string as one field, a list of
 * strings as one `key[]` field per item, as `-f key[]=` would name them; undefined for any other value or no JSON object.
 */
function inputFieldsOf(input: string | undefined): [string, string][] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input ?? '');
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const entries: readonly [string, unknown][] = Object.entries(parsed);
  const pairs: [string, string][] = [];
  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      pairs.push([key, value]);
    } else if (isStringList(value)) {
      value.forEach((item) => pairs.push([`${key}[]`, item]));
    } else {
      return undefined;
    }
  }
  return pairs;
}

/**
 * The fields of a command line after its method, in order: its `-f`/`-F` pairs, or the JSON body on stdin when the
 * line is `--input -` alone; undefined when a pair is not `key=value` or the body is not one this fake reads.
 */
function fieldsOf(args: readonly string[], input: string | undefined): [string, string][] | undefined {
  if (args.length === 2 && args[0] === '--input' && args[1] === '-') {
    return inputFieldsOf(input);
  }
  const pairs: [string, string][] = [];
  for (let at = 0; at < args.length; at += 2) {
    const flag = args[at];
    const pair = args[at + 1];
    const equals = pair?.indexOf('=') ?? -1;
    if ((flag !== '-f' && flag !== '-F') || pair === undefined || equals < 1) {
      return undefined;
    }
    pairs.push([pair.slice(0, equals), pair.slice(equals + 1)]);
  }
  return pairs;
}

function valuesOf(fields: readonly [string, string][], key: string): string[] {
  return fields.filter(([name]) => name === key).map(([, value]) => value);
}

/** A search's query as the GitHub connector sends it: `repo:<r> "<term>"... is:issue|is:pr[ is:open|is:closed]`. */
const SEARCH_QUERY = /^repo:(\S+)((?: "[^"\s]+")+) is:(issue|pr)(?: is:(open|closed))?$/u;

interface SearchAsked {
  readonly repo: string;
  readonly terms: readonly string[];
  readonly pull: boolean;
  readonly state: 'open' | 'closed' | undefined;
  readonly perPage: number;
}

/** The search a `-f q=... -f per_page=N` pair asks for; undefined for a query this fake does not read. */
function searchAsked(fields: readonly [string, string][]): SearchAsked | undefined {
  const [q] = valuesOf(fields, 'q');
  const [perPage] = valuesOf(fields, 'per_page');
  const parts = SEARCH_QUERY.exec(q ?? '');
  if (parts === null || perPage === undefined || fields.length !== 2) {
    return undefined;
  }
  const [, repo = '', quoted = '', kind, state] = parts;
  return {
    repo,
    terms: quoted
      .trim()
      .split(' ')
      .map((term) => term.slice(1, -1).toLowerCase()),
    pull: kind === 'pr',
    state: state === 'open' || state === 'closed' ? state : undefined,
    perPage: Number(perPage),
  };
}

/**
 * One repository on GitHub, faked behind `gh api` as the GitHub connector calls it: the REST lines that open an issue,
 * comment on it, replace its body (their text a JSON body on stdin, or `-f` fields), close it, add and take off its labels and assignees, and read a label. It holds
 * what those lines change, as GitHub does, so the tracker contract reads the result past the port. GitHub's own
 * answers are kept where the contract can see them: a write on an issue it does not hold, and a label taken off an
 * issue that does not carry it, answer Not Found; a login that may not be assigned is left out with no error. Any
 * other line fails, so a spec sees a call this fake does not know.
 */
export class GitHubWorld implements GhRunner {
  /** Every command line run, in order. */
  readonly ran: (readonly string[])[] = [];
  private readonly issues = new Map<number, GitHubIssue>();
  private readonly labels = new Set<string>();
  private readonly people = new Set<string>();
  private last = 0;

  readonly repo: string;

  constructor(repo: string) {
    this.repo = repo;
  }

  run(request: GhRequest): Promise<GhResult> {
    this.ran.push(request.args);
    return Promise.resolve(this.answer(request.args, request.input));
  }

  /** The tracker contract's view of this repository. */
  world(): TrackerWorld {
    return {
      repo: this.repo,
      fileByHand: (title, body) => this.file(title, body, []),
      makeLabel: (name) => {
        this.labels.add(name);
      },
      addPerson: (login) => {
        this.people.add(login);
      },
      issue: (target): WorldIssue | undefined => {
        const held = target.repo === this.repo ? this.issues.get(target.number) : undefined;
        if (held === undefined) {
          return undefined;
        }
        const reason = held.stateReason === null ? undefined : REASON_OF.get(held.stateReason);
        return { title: held.title, body: held.body, state: held.state, reason, labels: [...held.labels], assignees: [...held.assignees], comments: [...held.comments] };
      },
    };
  }

  /** The tracker reads contract's view of this repository: issues a person files by hand, in any state. */
  readsWorld(): TrackerReadsWorld {
    return {
      repo: this.repo,
      file: (filing: Filing) => {
        const target = this.file(filing.title, filing.body, filing.labels ?? []);
        const held = this.issues.get(target.number);
        if (held !== undefined) {
          held.assignees = [...(filing.assignees ?? [])];
          if (filing.state === 'closed') {
            held.state = 'closed';
            held.stateReason = 'completed';
          }
        }
        return target;
      },
    };
  }

  private file(title: string, body: string, labels: readonly string[]): IssueTarget {
    this.last += 1;
    for (const label of labels) {
      // GitHub makes a label an issue is opened with when the repository lacks it.
      this.labels.add(label);
    }
    this.issues.set(this.last, { title, body, state: 'open', stateReason: null, labels: [...labels], assignees: [], comments: [] });
    return { repo: this.repo, number: this.last };
  }

  /**
   * One page of GitHub's issue search: the issues holding every term in their title or body, case aside, oldest first;
   * none for a search of pull requests, which this repository holds none of. `total_count` counts every match.
   */
  private search(asked: SearchAsked): GhResult {
    const matches =
      asked.repo !== this.repo || asked.pull
        ? []
        : [...this.issues].filter(([, issue]) => (asked.state === undefined || issue.state === asked.state) && asked.terms.every((term) => `${issue.title}\n${issue.body}`.toLowerCase().includes(term)));
    return ok({
      total_count: matches.length,
      items: matches.slice(0, asked.perPage).map(([number, issue]) => ({ number, title: issue.title, state: issue.state, repository_url: `https://api.github.com/repos/${this.repo}` })),
    });
  }

  private answer(args: readonly string[], input: string | undefined): GhResult {
    const [verb, path, xFlag, method, ...rest] = args;
    const fields = fieldsOf(rest, input);
    if (verb === 'api' && path === 'search/issues' && xFlag === '-X' && method === 'GET' && fields !== undefined) {
      const asked = searchAsked(fields);
      return asked === undefined ? this.unknown(args) : this.search(asked);
    }
    const base = `repos/${this.repo}/`;
    if (verb !== 'api' || path === undefined || !path.startsWith(base)) {
      return this.unknown(args);
    }
    const route = path.slice(base.length).split('/');
    if (route[0] === 'labels' && route.length === 2 && xFlag === undefined) {
      return this.labels.has(decodeURIComponent(route[1] ?? '')) ? ok({ name: route[1] }) : NOT_FOUND;
    }
    if (route[0] !== 'issues' || xFlag !== '-X' || method === undefined || fields === undefined) {
      return this.unknown(args);
    }
    if (route.length === 1 && method === 'POST') {
      const [title] = valuesOf(fields, 'title');
      const [body] = valuesOf(fields, 'body');
      return title === undefined || body === undefined ? this.unknown(args) : ok({ number: this.file(title, body, valuesOf(fields, 'labels[]')).number });
    }
    const issue = this.issues.get(Number(route[1]));
    if (issue === undefined) {
      return NOT_FOUND;
    }
    return this.onIssue(issue, route.slice(2), method, fields) ?? this.unknown(args);
  }

  /** A line on one held issue, by the rest of its path; undefined for one this fake does not know. */
  private onIssue(issue: GitHubIssue, route: readonly string[], method: string, fields: readonly [string, string][]): GhResult | undefined {
    const [what, item] = route;
    if (what === undefined && method === 'GET') {
      return ok({
        title: issue.title,
        body: issue.body === '' ? null : issue.body,
        state: issue.state,
        labels: issue.labels.map((name) => ({ name })),
        assignees: issue.assignees.map((login) => ({ login })),
      });
    }
    if (what === undefined && method === 'PATCH') {
      const [body] = valuesOf(fields, 'body');
      issue.body = body ?? issue.body;
      if (valuesOf(fields, 'state').includes('closed')) {
        issue.state = 'closed';
        issue.stateReason = valuesOf(fields, 'state_reason')[0] ?? 'completed';
      }
      return ok();
    }
    if (what === 'comments' && method === 'POST') {
      const [body] = valuesOf(fields, 'body');
      if (body === undefined) {
        return undefined;
      }
      issue.comments.push(body);
      return ok();
    }
    if (what === 'labels' && item === undefined && method === 'POST') {
      const given = valuesOf(fields, 'labels[]');
      given.forEach((label) => this.labels.add(label));
      issue.labels = [...new Set([...issue.labels, ...given])];
      return ok();
    }
    if (what === 'labels' && item !== undefined && method === 'DELETE') {
      const label = decodeURIComponent(item);
      if (!issue.labels.includes(label)) {
        return NOT_FOUND;
      }
      issue.labels = issue.labels.filter((each) => each !== label);
      return ok();
    }
    if (what === 'assignees' && method === 'POST') {
      const may = valuesOf(fields, 'assignees[]').filter((login) => this.people.has(login));
      issue.assignees = [...new Set([...issue.assignees, ...may])];
      return ok();
    }
    if (what === 'assignees' && method === 'DELETE') {
      const off = valuesOf(fields, 'assignees[]');
      issue.assignees = issue.assignees.filter((login) => !off.includes(login));
      return ok();
    }
    return undefined;
  }

  private unknown(args: readonly string[]): GhResult {
    return { end: { kind: 'exited', code: 1 }, stdout: '', stderr: `the fake GitHub does not know: gh ${args.join(' ')}` };
  }
}
