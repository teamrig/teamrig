import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { JsonRecord } from '../core/guards.ts';
import { CliHarness, EVENTS_PATH, TEAM } from '../testing/cli-harness.ts';
import { FakeCredentials } from '../testing/fake-credentials.ts';
import { FakeGh, ghIssue } from '../testing/fake-gh.ts';
import { FakeHttp } from '../testing/fake-http.ts';
import { TimeZone } from '../core/zone.ts';
import { OWN_NUMBERS } from '../register/numbering.ts';
import { RegisterPolicy } from '../register/policy.ts';
import { NO_GOAL_RECORDS, NOTHING_ELSEWHERE, Register } from '../register/register.ts';
import { JsonlEventLog } from '../register/store.ts';
import { importRules } from '../sync/map.ts';
import type { Task } from '../register/fold.ts';
import { testTask } from '../testing/task.ts';
import { testConfig } from '../testing/config.ts';
import { FakeClock } from '../testing/fake-clock.ts';
import { InlineMutex } from '../testing/inline-mutex.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { teamPaths } from '../core/home.ts';
import { fileReporterStore, fileScopeStore, heldAt, importConnectors, scopeLines, scopeRequestOf, syncTrackers, trustLines, type TrackerSyncRun } from './commands/tracker-sync.ts';
import type { ConnectorLoader } from './issue-hosts.ts';
import { connectorState } from './connector-state.ts';
import { loadConnector } from '../composition/loader.ts';
import type { ConnectorPorts, RefCodec, Tracker } from '../plugin-api/index.ts';
import type { HostIssue } from '../issues/issue.ts';
import { FakeIssueHost } from '../testing/fake-issue-host.ts';
import { testHostIssue } from '../testing/host-issue.ts';
import { connectorDeclarationData } from '../testing/manifests.ts';
import { trackerOnly } from '../testing/split-hosts.ts';
import { heldScopeLine, type ScopeRunKind } from '../sync/scope-hold.ts';
import { EXIT } from './runtime.ts';
import { SHOWN_LEFT_OUT } from './commands/issue-sync-lines.ts';

const SEARCH = 'https://acme.atlassian.net/rest/api/3/search/jql';
const MYSELF = 'https://acme.atlassian.net/rest/api/3/myself';
const CREDENTIAL = 'teamrig-jira-acme';
const JIRA = { site: 'acme', projects: ['ENG'] };
/** A team that reads the Jira project ENG on site acme, and no GitHub repository. */
const JIRA_TEAM: JsonRecord = { ...TEAM, connectors: { jira: JIRA } };
/** A team that reads ENG on Jira and acme/web on GitHub. */
const BOTH_TEAM: JsonRecord = { ...TEAM, github: { repos: ['acme/web'] }, connectors: { jira: JIRA } };

const ACCESS = `ACCESS acme: read with the API token saved as ${CREDENTIAL}`;
const NO_GITHUB = 'OFF no repository to read: list them as "owner/name" under github.repos in the team config; nothing of GitHub was read or written';
/** The preview of ENG-1 and ENG-2 on a closed project: the default inside lets their inside reporter in, routed to the lead. */
const LET_IN = 'TRUST acme/eng: 2 let in, the reporter matches inside (accountType atlassian): jira:ENG-1 jira:ENG-2';
/** The inside reporter of ENG-1 and ENG-2, which no --yes took yet. */
const NEW_REPORTER = 'REPORTER acme/eng: a-reporter (Dana Reporter) let in 2 issue(s), NEW since the last --yes';
const TWO_TO_ADD = ['REPO acme/eng: 2 to add, 0 to change, 0 unchanged', 'ADD new jira:ENG-1 p2 lead: "Issue ENG-1"', 'ADD new jira:ENG-2 p2 lead: "Issue ENG-2"', LET_IN, NEW_REPORTER];
const PREVIEW = 'PREVIEW nothing was written; teamrig issue sync --yes writes the above as jira';
/** The TRUST line, standing for the LEFT OUT one, of an issue the rule kept out because Jira gave no edit history. */
function unreadHistory(key: string): string {
  return `TRUST acme/eng: 1 kept out, its edit history could not be read whole (the read of ${key}'s edit history failed: Jira gave no answer: no answer is queued for GET https://acme.atlassian.net/rest/api/3/issue/${key}/changelog?startAt=0&maxResults=100): jira:${key}`;
}

/** A Jira issue `key`, open, as the search answers it, assigned to `assignee` (the signed-in account by default). */
function jiraIssue(key: string, assignee: string = 'a-me'): JsonRecord {
  return { id: '10001', key, fields: { summary: `Issue ${key}`, status: { statusCategory: { key: 'new' } }, assignee: { accountId: assignee }, reporter: { accountId: 'a-reporter', accountType: 'atlassian', displayName: 'Dana Reporter' } } };
}

/** The read of project ENG that the public-project guard sends with no credentials. */
const PROJECT = 'https://acme.atlassian.net/rest/api/3/project/ENG';

/** A Jira API that says the sign-in is account a-me, and turns away a read of ENG without one, so ENG is closed. */
function signedIn(): FakeHttp {
  return new FakeHttp().answers('GET', MYSELF, 200, '{"accountId":"a-me"}').answers('GET', PROJECT, 404, '');
}

/** `http` answering an empty edit history for each of `keys`, so no outside edit keeps the issue out. */
function noEdits(http: FakeHttp, ...keys: readonly string[]): FakeHttp {
  return keys.reduce((answered, key) => answered.answers('GET', `https://acme.atlassian.net/rest/api/3/issue/${key}/changelog?startAt=0&maxResults=100`, 200, JSON.stringify({ values: [], isLast: true })), http);
}

/** A Jira API whose search of ENG answers two open issues, both reported by an inside account and never edited. */
function twoJiraIssues(): FakeHttp {
  return noEdits(signedIn().answers('POST', SEARCH, 200, JSON.stringify({ issues: [jiraIssue('ENG-1'), jiraIssue('ENG-2')] })), 'ENG-1', 'ENG-2');
}

/** A store holding the API token of site acme, and the GitHub token of owner acme, so GitHub's import reads too. */
function savedToken(): FakeCredentials {
  return new FakeCredentials().saves(CREDENTIAL, 'someone@example.com:the-token').saves('teamrig-gh-acme', 'acme-issues-token');
}

describe('importConnectors', () => {
  it('names the import sources of the connectors map other than GitHub, and no other id', () => {
    assert.deepEqual(importConnectors({ connectors: { github: {}, jira: {}, someday: {} } }), ['jira']);
    assert.deepEqual(importConnectors({ connectors: {} }), []);
  });
});

/**
 * The import of the other trackers for a team reading ENG on Jira, whose connector adapters come from `load`: each
 * run of `kind` reads and writes the same register and the same scope files.
 */
function importer(load: ConnectorLoader): { readonly files: MemoryFiles; readonly run: (kind: ScopeRunKind) => TrackerSyncRun } {
  const config = testConfig({ connectors: { jira: JIRA } });
  const files = new MemoryFiles();
  const register = new Register({
    log: new JsonlEventLog(new MemoryFiles(), 'register/events.jsonl'),
    mutex: new InlineMutex(),
    numbering: OWN_NUMBERS,
    elsewhere: NOTHING_ELSEWHERE,
    goals: NO_GOAL_RECORDS,
    clock: new FakeClock('2030-01-08T10:00:00.000Z'),
    zone: TimeZone.UTC,
    policy: new RegisterPolicy(config),
    skills: { exists: async () => false },
    autoArchive: true,
  });
  const runtime = { run: () => Promise.reject(new Error('no program runs here')), http: new FakeHttp(), credentials: savedToken(), env: {} };
  const scopes = fileScopeStore(files, PATHS);
  const reporters = fileReporterStore(files, PATHS);
  return { files, run: (kind) => ({ runtime, config, register, rules: importRules(config), since: '2030-01-01', kind, scopes, reporters, load }) };
}

/** The team folders the scope files of `importer` are kept under. */
const PATHS = teamPaths('/kit', 'acme', undefined);

/** A writing run of the other trackers' import for a team reading ENG on Jira, whose connector adapters come from `load`. */
function runWith(load: ConnectorLoader): TrackerSyncRun {
  return importer(load).run('yes');
}

/** The place the fake tracker of `servingTracker` names, as Jira writes ENG of site acme. */
const ENG = 'acme/eng';

/** Refs `jira:ENG-<n>` for the issues of ENG, and none for any other place. */
const ENG_REFS: RefCodec = {
  refOf: (target) => (target.repo === ENG ? `jira:ENG-${target.number}` : undefined),
  parseRef: (ref) => {
    const found = /^jira:ENG-(\d+)$/.exec(ref);
    return found === null ? undefined : { repo: ENG, number: Number(found[1]) };
  },
  pageOf: (target) => (target.repo === ENG ? `https://acme.atlassian.net/browse/ENG-${target.number}` : undefined),
};

/** A loader whose adapter, a sound declaration of the id asked for, builds `tracker` reading the one place ENG. */
function servingTracker(tracker: Tracker): ConnectorLoader {
  const ports: ConnectorPorts = { tracker, targets: [ENG], refs: ENG_REFS };
  return (id) => loadConnector(id, () => Promise.resolve({ default: { declaration: connectorDeclarationData({ id }), configure: () => () => ports } }));
}

/** Open issue `number` of ENG, labelled for the team and written by an inside author, so the trust rule lets it in. */
function engIssue(number: number): HostIssue {
  return testHostIssue(number, { repo: ENG, labels: ['teamrig'] });
}

describe('syncTrackers', () => {
  it('fails only that connector when the loader refuses its adapter, and names why', async () => {
    const lines: string[] = [];
    const load: ConnectorLoader = (id) => Promise.resolve({ kind: 'refused', id, notices: ['it needs a name'] });
    const end = await syncTrackers(runWith(load), (line) => lines.push(line));
    const reason = 'the jira connector adapter gave no host: it needs a name';
    assert.deepEqual(lines, [`FAILED the jira import: ${reason}; nothing of it was read or written`]);
    assert.deepEqual(end, { ends: ['failed'], written: 0, added: [], failures: [{ repo: 'jira', reason }], scopeHolds: [] });
  });

  it('holds the adds of a scope no person took on an automatic run, tells the lead once, and adds once --yes takes it (T5013)', async () => {
    const fake = new FakeIssueHost().lists(engIssue(1));
    const { files, run } = importer(servingTracker(trackerOnly(fake)));
    const held = `HELD ${ENG}: 1 issue(s) of a new or wider import scope wait for teamrig issue sync --yes`;
    const cap = run('auto').config.sync.maxNewPerSync;

    const firstLines: string[] = [];
    const first = await syncTrackers(run('auto'), (line) => firstLines.push(line));
    assert.deepEqual(first.added, []);
    assert.ok(firstLines.includes(held), firstLines.join('\n'));
    assert.deepEqual(first.scopeHolds, [heldScopeLine('jira', ENG, 1, cap)]);

    const againLines: string[] = [];
    const again = await syncTrackers(run('auto'), (line) => againLines.push(line));
    assert.deepEqual(again.added, []);
    assert.ok(againLines.includes(held), againLines.join('\n'));
    assert.deepEqual(again.scopeHolds, [], 'the lead was told of this scope already');

    const taken = await syncTrackers(run('yes'), () => undefined);
    assert.deepEqual(taken.added.map((task) => task.ref), ['jira:ENG-1']);
    assert.notEqual(await files.read(connectorState(PATHS, 'jira').scope), undefined);

    fake.lists(engIssue(1), engIssue(2));
    const laterLines: string[] = [];
    const later = await syncTrackers(run('auto'), (line) => laterLines.push(line));
    assert.deepEqual(later.added.map((task) => task.ref), ['jira:ENG-2']);
    assert.deepEqual(later.scopeHolds, []);
    assert.ok(laterLines.every((line) => !line.startsWith('HELD')), laterLines.join('\n'));
  });

  it('marks an inside reporter NEW until a --yes takes it, which a preview or an automatic run never does (T5012)', async () => {
    const inside = { trusted: true, why: 'the reporter matches inside (accountType atlassian)' } as const;
    const fake = new FakeIssueHost().lists(testHostIssue(1, { repo: ENG, labels: ['teamrig'], author: 'a-1', authorName: 'Ari', ruled: inside }));
    const { files, run } = importer(servingTracker(trackerOnly(fake)));
    const stored = connectorState(PATHS, 'jira').reporters;
    const fresh = 'REPORTER acme/eng: a-1 (Ari) let in 1 issue(s), NEW since the last --yes';
    const reporterLinesOf = async (kind: ScopeRunKind): Promise<string[]> => {
      const lines: string[] = [];
      await syncTrackers(run(kind), (line) => lines.push(line));
      return lines.filter((line) => line.startsWith('REPORTER'));
    };

    assert.deepEqual(await reporterLinesOf('preview'), [fresh]);
    assert.deepEqual(await reporterLinesOf('auto'), [fresh]);
    assert.equal(await files.read(stored), undefined, 'only a --yes keeps a reporter');
    assert.deepEqual(await reporterLinesOf('yes'), [fresh]);
    assert.deepEqual(await reporterLinesOf('preview'), ['REPORTER acme/eng: a-1 (Ari) let in 1 issue(s)']);
  });

  it('lets an error it does not know end the run', async () => {
    const load: ConnectorLoader = () => Promise.reject(new Error('disk gone'));
    await assert.rejects(syncTrackers(runWith(load), () => undefined), /disk gone/);
  });
});

describe('teamrig issue sync of another tracker', () => {
  it('previews the Jira import, adding the issues the trust rule lets in, and writes nothing', async () => {
    const kit = new CliHarness(JIRA_TEAM);
    const http = twoJiraIssues();
    const result = await kit.run(['issue', 'sync'], { http, credentials: savedToken() });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.deepEqual(result.stdout, [ACCESS, ...TWO_TO_ADD, PREVIEW, NO_GITHUB]);
    assert.equal(kit.files.get(EVENTS_PATH), undefined);
  });

  it('writes the tasks as jira with --yes', async () => {
    const kit = new CliHarness(JIRA_TEAM);
    const result = await kit.run(['issue', 'sync', '--yes'], { http: twoJiraIssues(), credentials: savedToken() });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.deepEqual(result.stdout, [
      ACCESS,
      'REPO acme/eng: 2 added, 0 changed, 0 unchanged',
      'ADD T1 jira:ENG-1 p2 lead: "Issue ENG-1"',
      'ADD T2 jira:ENG-2 p2 lead: "Issue ENG-2"',
      LET_IN,
      NEW_REPORTER,
      'WROTE 2 change(s) to the task list as jira; Jira was only read',
      NO_GITHUB,
    ]);
    assert.notEqual(kit.files.get(EVENTS_PATH), undefined);
  });

  it('keeps every issue out, with a NOTE naming the key to set, when anyone may browse the project (T5012)', async () => {
    const http = new FakeHttp()
      .answers('GET', MYSELF, 200, '{"accountId":"a-me"}')
      .answers('GET', PROJECT, 200, '{}')
      .answers('POST', SEARCH, 200, JSON.stringify({ issues: [jiraIssue('ENG-1'), jiraIssue('ENG-2')] }));
    const result = await new CliHarness(JIRA_TEAM).run(['issue', 'sync'], { http, credentials: savedToken() });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.deepEqual(result.stdout, [
      ACCESS,
      'NOTE acme/eng: anyone may browse ENG: its read without a sign-in was answered 200, so the default inside is not applied; set connectors.jira.trust.projects.ENG.inside',
      'REPO acme/eng: 0 to add, 0 to change, 0 unchanged',
      'TRUST acme/eng: 2 kept out, anyone may browse the project, so the default inside is not applied; set connectors.jira.trust.projects.ENG.inside: jira:ENG-1 jira:ENG-2',
      PREVIEW,
      NO_GITHUB,
    ]);
    assert.ok(http.requests.every((request) => !request.url.includes('/changelog')), 'no history is read on an open project');
  });

  it('keeps out an issue whose edit history Jira does not give (T5012)', async () => {
    const http = signedIn().answers('POST', SEARCH, 200, JSON.stringify({ issues: [jiraIssue('ENG-1'), jiraIssue('ENG-2')] }));
    const result = await new CliHarness(JIRA_TEAM).run(['issue', 'sync'], { http, credentials: savedToken() });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.deepEqual(result.stdout, [ACCESS, 'REPO acme/eng: 0 to add, 0 to change, 0 unchanged', unreadHistory('ENG-1'), unreadHistory('ENG-2'), PREVIEW, NO_GITHUB]);
  });

  it('reads nothing of Jira when the machine turns it off', async () => {
    const http = twoJiraIssues();
    const result = await new CliHarness(JIRA_TEAM).run(['issue', 'sync'], { http, credentials: savedToken(), env: { TEAMRIG_CONNECTOR_JIRA: 'off' } });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(result.stdout, ['OFF TEAMRIG_CONNECTOR_JIRA=off turns the jira import off on this machine; nothing of it was read or written', NO_GITHUB]);
    assert.deepEqual(http.requests, []);
  });

  it('reads nothing of Jira when its section names no project', async () => {
    const http = twoJiraIssues();
    const result = await new CliHarness({ ...TEAM, connectors: { jira: { site: 'acme' } } }).run(['issue', 'sync'], { http, credentials: savedToken() });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(result.stdout, ['OFF connectors.jira names no place to read; nothing of it was read or written', NO_GITHUB]);
    assert.deepEqual(http.requests, []);
  });

  it('fails the run, and only that project, when Jira cannot be reached', async () => {
    const http = twoJiraIssues();
    const result = await new CliHarness(JIRA_TEAM).run(['issue', 'sync'], { http, credentials: new FakeCredentials() });
    assert.equal(result.code, EXIT.failed);
    const [failed, ...rest] = result.stdout;
    assert.match(failed ?? '', /^FAILED acme\/eng: .*; its tasks stay as they are$/);
    assert.deepEqual(rest, ['PREVIEW nothing was written; teamrig issue sync --yes writes the above as jira', NO_GITHUB]);
    assert.deepEqual(http.requests, []);
  });

  it('fails the project when Jira cannot list its issues, and runs on', async () => {
    const http = signedIn().answers('POST', SEARCH, 500, '{}');
    const result = await new CliHarness(JIRA_TEAM).run(['issue', 'sync'], { http, credentials: savedToken() });
    assert.equal(result.code, EXIT.failed, [...result.stdout, ...result.stderr].join('\n'));
    const [access, failed, ...rest] = result.stdout;
    assert.equal(access, ACCESS);
    assert.match(failed ?? '', /^FAILED acme\/eng: .*; its tasks stay as they are$/);
    assert.deepEqual(rest, ['PREVIEW nothing was written; teamrig issue sync --yes writes the above as jira', NO_GITHUB]);
  });

  it('notes an item that reads as no issue, and names none left out when none is open', async () => {
    const http = signedIn().answers('POST', SEARCH, 200, JSON.stringify({ issues: [{ key: 'ENG-9' }] }));
    const result = await new CliHarness(JIRA_TEAM).run(['issue', 'sync'], { http, credentials: savedToken() });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.deepEqual(result.stdout, [
      ACCESS,
      'NOTE acme/eng: 1 item(s) Jira listed did not read as issues of ENG and were left out',
      'REPO acme/eng: 0 to add, 0 to change, 0 unchanged',
      'PREVIEW nothing was written; teamrig issue sync --yes writes the above as jira',
      NO_GITHUB,
    ]);
  });

  it("refuses a Jira section the adapter refuses, and still runs GitHub's import", async () => {
    const gh = new FakeGh().holds('acme/web', [ghIssue('acme/web', 7, { title: 'Fix login' })]);
    const team = { ...BOTH_TEAM, connectors: { jira: { site: 'acme.atlassian.net', projects: ['ENG'] } } };
    const result = await new CliHarness(team).run(['issue', 'sync'], { gh, http: new FakeHttp(), credentials: savedToken() });
    assert.equal(result.code, EXIT.refused, [...result.stdout, ...result.stderr].join('\n'));
    const [refused] = result.stdout;
    assert.match(refused ?? '', /^REFUSED the jira import: connectors\.jira\.site must be .*; nothing of it was read or written$/);
    assert.ok(result.stdout.includes('ADD new gh:acme/web#7 p2 lead: "Fix login"'), result.stdout.join('\n'));
  });

  it('reads no other tracker when --repo names one GitHub repository', async () => {
    const http = twoJiraIssues();
    const gh = new FakeGh().holds('acme/web', []);
    const result = await new CliHarness(BOTH_TEAM).run(['issue', 'sync', '--repo', 'acme/web'], { gh, http, credentials: savedToken() });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.deepEqual(http.requests, []);
    assert.ok(result.stdout.every((line) => !line.includes('jira')), result.stdout.join('\n'));
  });

  it("still imports Jira when the machine turns GitHub's import off", async () => {
    const result = await new CliHarness(BOTH_TEAM).run(['issue', 'sync'], { http: twoJiraIssues(), credentials: savedToken(), env: { TEAMRIG_GITHUB: 'off' } });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.deepEqual(result.stdout, [
      ACCESS,
      ...TWO_TO_ADD,
      PREVIEW,
      'OFF TEAMRIG_GITHUB=off turns the GitHub import off on this machine; nothing of it was read or written',
    ]);
  });
});

describe('the import scope of another tracker (T5013)', () => {
  const SCOPED_JQL = /^project = "ENG" AND \(statusCategory != Done OR statusCategoryChangedDate >= "\d{4}-\d{2}-\d{2}"\) AND \(assignee in \(currentUser\(\)\) OR labels in \("teamrig"\)\)$/;

  it("asks Jira only for the team's and the labelled issues, and drops what it gave outside the scope with a SCOPE line", async () => {
    const http = noEdits(signedIn().answers('POST', SEARCH, 200, JSON.stringify({ issues: [jiraIssue('ENG-1'), jiraIssue('ENG-2', 'a-stranger')] })), 'ENG-1');
    const result = await new CliHarness(JIRA_TEAM).run(['issue', 'sync'], { http, credentials: savedToken() });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.deepEqual(result.stdout, [
      ACCESS,
      'REPO acme/eng: 1 to add, 0 to change, 0 unchanged',
      'ADD new jira:ENG-1 p2 lead: "Issue ENG-1"',
      'SCOPE acme/eng: 1 issue(s) outside the import scope dropped; sync.scope widens it',
      'TRUST acme/eng: 1 let in, the reporter matches inside (accountType atlassian): jira:ENG-1',
      'REPORTER acme/eng: a-reporter (Dana Reporter) let in 1 issue(s), NEW since the last --yes',
      PREVIEW,
      NO_GITHUB,
    ]);
    const search = http.requests.find((request) => request.url === SEARCH);
    const sentBody = search !== undefined && 'body' in search ? search.body : undefined;
    const body: unknown = sentBody === undefined ? undefined : JSON.parse(sentBody);
    const jql = typeof body === 'object' && body !== null && 'jql' in body && typeof body.jql === 'string' ? body.jql : '';
    assert.match(jql, SCOPED_JQL);
  });

  it('reads the whole project, as before, when sync.scope.all is on', async () => {
    const http = twoJiraIssues();
    const result = await new CliHarness({ ...JIRA_TEAM, sync: { scope: { all: true } } }).run(['issue', 'sync'], { http, credentials: savedToken() });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.deepEqual(result.stdout, [ACCESS, ...TWO_TO_ADD, PREVIEW, NO_GITHUB]);
    assert.ok(http.requests.every((request) => request.url !== MYSELF));
  });

  it('counts the accept label in the scope, once, whatever its case', () => {
    const scope = { all: false, assigned: 'team', labels: ['ops'] } as const;
    assert.deepEqual(scopeRequestOf(scope, 'teamrig', [3]), { scope: { ...scope, labels: ['ops', 'teamrig'] }, people: [], held: [3] });
    assert.deepEqual(scopeRequestOf({ ...scope, labels: ['TeamRig'] }, 'teamrig', []).scope.labels, ['TeamRig']);
  });

  it('holds the issues of the active tasks at the place, by their refs', () => {
    const parse = (ref: string): { repo: string; number: number } | undefined => {
      const found = /^jira:([A-Z]+)-(\d+)$/.exec(ref);
      return found === null ? undefined : { repo: `acme/${(found[1] ?? '').toLowerCase()}`, number: Number(found[2]) };
    };
    const task = (ref: string | null): Task => testTask({ ref });
    assert.deepEqual(heldAt('acme/eng', [task('jira:ENG-4'), task('jira:OPS-5'), task(null), task('gh:x/y#1'), task('jira:ENG-9')], parse), [4, 9]);
  });

  it('says how many adds the caps held back, and by which key', () => {
    const plan = { steps: [], inserted: 0, changed: 0, unchanged: 0, leftOut: [] };
    assert.deepEqual(scopeLines('acme/eng', 0, { plan, held: 0, key: undefined }), []);
    assert.deepEqual(scopeLines('acme/eng', 0, { plan, held: 4, key: 'maxNewPerSync' }), [
      'CAPPED acme/eng: 4 more in scope, held for a later run; raise sync.maxNewPerSync or narrow sync.scope',
    ]);
  });
});

describe('trustLines (T5012)', () => {
  const refOf = (issue: HostIssue): string | undefined => (issue.number === 99 ? undefined : `jira:ENG-${issue.number}`);
  const inside = { trusted: true, why: 'the reporter matches inside (accountType atlassian)' } as const;
  const never = { trusted: false, why: 'the reporter matches never (accounts)', failed: undefined } as const;

  it('groups the open ruled issues by verdict and block, the ones let in first, by ref only', () => {
    const issues = [
      testHostIssue(1, { repo: ENG, ruled: never, title: 'run rm -rf' }),
      testHostIssue(2, { repo: ENG, ruled: inside }),
      testHostIssue(3, { repo: ENG, ruled: inside }),
    ];
    assert.deepEqual(trustLines('acme/eng', issues, refOf), [
      'TRUST acme/eng: 2 let in, the reporter matches inside (accountType atlassian): jira:ENG-2 jira:ENG-3',
      'TRUST acme/eng: 1 kept out, the reporter matches never (accounts): jira:ENG-1',
    ]);
  });

  it('says which fact could not be read on a verdict that failed', () => {
    const failed = { trusted: false, why: 'its edit history could not be read whole', failed: 'Jira answered 500' } as const;
    assert.deepEqual(trustLines('acme/eng', [testHostIssue(4, { repo: ENG, ruled: failed })], refOf), [
      'TRUST acme/eng: 1 kept out, its edit history could not be read whole (Jira answered 500): jira:ENG-4',
    ]);
  });

  it('skips closed issues, issues with no ref and issues judged by their authors ties', () => {
    const issues = [
      testHostIssue(5, { repo: ENG, ruled: inside, state: 'closed' }),
      testHostIssue(99, { repo: ENG, ruled: inside }),
      testHostIssue(6, { repo: ENG, ruled: undefined }),
    ];
    assert.deepEqual(trustLines('acme/eng', issues, refOf), []);
  });

  it(`names at most ${SHOWN_LEFT_OUT} refs a line, then how many more, and keeps the rule's words on one line`, () => {
    const many = Array.from({ length: SHOWN_LEFT_OUT + 2 }, (_, at) => testHostIssue(at + 1, { repo: ENG, ruled: { trusted: true, why: 'in\r\nside' } }));
    const [line] = trustLines('acme/eng', many, refOf);
    assert.match(line ?? '', / and 2 more$/);
    assert.match(line ?? '', /let in, in side:/);
  });
});
