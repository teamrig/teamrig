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
import { heldAt, importConnectors, scopeLines, scopeRequestOf, syncTrackers, type TrackerSyncRun } from './commands/tracker-sync.ts';
import type { ConnectorLoader } from './issue-hosts.ts';
import { EXIT } from './runtime.ts';

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
/**
 * Every Jira issue is left out until the trust rule reads Jira's reporters (T4928): a Jira issue has no inside author
 * and no label event, so the accept label alone cannot let it in.
 */
const LEFT_OUT = 'LEFT OUT acme/eng: 2 open issue(s) the trust rule kept out: jira:ENG-1 jira:ENG-2';

/** A Jira issue `key`, open, as the search answers it, assigned to `assignee` (the signed-in account by default). */
function jiraIssue(key: string, assignee: string = 'a-me'): JsonRecord {
  return { id: '10001', key, fields: { summary: `Issue ${key}`, status: { statusCategory: { key: 'new' } }, assignee: { accountId: assignee }, reporter: { accountId: 'a-reporter', accountType: 'atlassian' } } };
}

/** A Jira API that says the sign-in is account a-me. */
function signedIn(): FakeHttp {
  return new FakeHttp().answers('GET', MYSELF, 200, '{"accountId":"a-me"}');
}

/** A Jira API whose search of ENG answers two open issues. */
function twoJiraIssues(): FakeHttp {
  return signedIn().answers('POST', SEARCH, 200, JSON.stringify({ issues: [jiraIssue('ENG-1'), jiraIssue('ENG-2')] }));
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

/** A writing run of the other trackers' import for a team reading ENG on Jira, whose connector adapters come from `load`. */
function runWith(load: ConnectorLoader): TrackerSyncRun {
  const config = testConfig({ connectors: { jira: JIRA } });
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
  return { runtime, config, register, rules: importRules(config), since: '2030-01-01', write: true, load };
}

describe('syncTrackers', () => {
  it('fails only that connector when the loader refuses its adapter, and names why', async () => {
    const lines: string[] = [];
    const load: ConnectorLoader = (id) => Promise.resolve({ kind: 'refused', id, notices: ['it needs a name'] });
    const end = await syncTrackers(runWith(load), (line) => lines.push(line));
    const reason = 'the jira connector adapter gave no host: it needs a name';
    assert.deepEqual(lines, [`FAILED the jira import: ${reason}; nothing of it was read or written`]);
    assert.deepEqual(end, { ends: ['failed'], written: 0, added: [], failures: [{ repo: 'jira', reason }] });
  });

  it('lets an error it does not know end the run', async () => {
    const load: ConnectorLoader = () => Promise.reject(new Error('disk gone'));
    await assert.rejects(syncTrackers(runWith(load), () => undefined), /disk gone/);
  });
});

describe('teamrig issue sync of another tracker', () => {
  it('previews the Jira import, leaving out every issue the trust rule does not let in, and writes nothing', async () => {
    const kit = new CliHarness(JIRA_TEAM);
    const http = twoJiraIssues();
    const result = await kit.run(['issue', 'sync'], { http, credentials: savedToken() });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.deepEqual(result.stdout, [ACCESS, 'REPO acme/eng: 0 to add, 0 to change, 0 unchanged', LEFT_OUT, 'PREVIEW nothing was written; teamrig issue sync --yes writes the above as jira', NO_GITHUB]);
    assert.equal(kit.files.get(EVENTS_PATH), undefined);
  });

  it('writes as jira with --yes, so a left-out issue still adds no task', async () => {
    const kit = new CliHarness(JIRA_TEAM);
    const result = await kit.run(['issue', 'sync', '--yes'], { http: twoJiraIssues(), credentials: savedToken() });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.deepEqual(result.stdout, [ACCESS, 'REPO acme/eng: 0 added, 0 changed, 0 unchanged', LEFT_OUT, 'WROTE 0 change(s) to the task list as jira; Jira was only read', NO_GITHUB]);
    assert.equal(kit.files.get(EVENTS_PATH), undefined);
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
      'REPO acme/eng: 0 to add, 0 to change, 0 unchanged',
      LEFT_OUT,
      'PREVIEW nothing was written; teamrig issue sync --yes writes the above as jira',
      'OFF TEAMRIG_GITHUB=off turns the GitHub import off on this machine; nothing of it was read or written',
    ]);
  });
});

describe('the import scope of another tracker (T5013)', () => {
  const SCOPED_JQL = /^project = "ENG" AND \(statusCategory != Done OR statusCategoryChangedDate >= "\d{4}-\d{2}-\d{2}"\) AND \(assignee in \(currentUser\(\)\) OR labels in \("teamrig"\)\)$/;

  it("asks Jira only for the team's and the labelled issues, and drops what it gave outside the scope with a SCOPE line", async () => {
    const http = signedIn().answers('POST', SEARCH, 200, JSON.stringify({ issues: [jiraIssue('ENG-1'), jiraIssue('ENG-2', 'a-stranger')] }));
    const result = await new CliHarness(JIRA_TEAM).run(['issue', 'sync'], { http, credentials: savedToken() });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.deepEqual(result.stdout, [
      ACCESS,
      'REPO acme/eng: 0 to add, 0 to change, 0 unchanged',
      'SCOPE acme/eng: 1 issue(s) outside the import scope dropped; sync.scope widens it',
      'LEFT OUT acme/eng: 1 open issue(s) the trust rule kept out: jira:ENG-1',
      'PREVIEW nothing was written; teamrig issue sync --yes writes the above as jira',
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
    assert.deepEqual(result.stdout, [ACCESS, 'REPO acme/eng: 0 to add, 0 to change, 0 unchanged', LEFT_OUT, 'PREVIEW nothing was written; teamrig issue sync --yes writes the above as jira', NO_GITHUB]);
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
