import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { JsonRecord } from '../core/guards.ts';
import { CliHarness, EVENTS_PATH, TEAM } from '../testing/cli-harness.ts';
import { FakeCredentials } from '../testing/fake-credentials.ts';
import { FakeGh, ghIssue } from '../testing/fake-gh.ts';
import { FakeHttp } from '../testing/fake-http.ts';
import { importConnectors } from './commands/tracker-sync.ts';
import { EXIT } from './runtime.ts';

const SEARCH = 'https://acme.atlassian.net/rest/api/3/search/jql';
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

/** A Jira issue `key`, open, as the search answers it. */
function jiraIssue(key: string): JsonRecord {
  return { id: '10001', key, fields: { summary: `Issue ${key}`, status: { statusCategory: { key: 'new' } }, reporter: { accountId: 'a-reporter', accountType: 'atlassian' } } };
}

/** A Jira API whose search of ENG answers two open issues. */
function twoJiraIssues(): FakeHttp {
  return new FakeHttp().answers('POST', SEARCH, 200, JSON.stringify({ issues: [jiraIssue('ENG-1'), jiraIssue('ENG-2')] }));
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
