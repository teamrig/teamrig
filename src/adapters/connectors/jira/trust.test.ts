import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTrust, type ResolvedTrust, type TrustAuthor } from '../../../plugin-api/index.ts';
import { connectorDeps } from '../../../testing/adapter-deps.ts';
import { FakeCredentials } from '../../../testing/fake-credentials.ts';
import { FakeHttp } from '../../../testing/fake-http.ts';
import { JiraClient } from './client.ts';
import { parseProject, type JiraProject } from './site.ts';
import { CHANGELOG_PAGE, insideKey, JIRA_TRUST_DEFAULTS, judgeIssue, MAX_CHANGELOG_PAGES, readEditors, reporterOf, trustAuthor } from './trust.ts';

const API = 'https://acme.atlassian.net/rest/api/3';
const CREDENTIAL = 'teamrig-jira-acme';

function changelog(startAt: number): string {
  return `${API}/issue/ENG-1/changelog?startAt=${startAt}&maxResults=${CHANGELOG_PAGE}`;
}

function project(): JiraProject {
  const parsed = parseProject('acme/eng');
  assert.ok(parsed !== undefined);
  return parsed;
}

function client(http: FakeHttp): JiraClient {
  const credentials = new FakeCredentials().saves(CREDENTIAL, 'someone@example.com:the-token');
  return new JiraClient(http, credentials, connectorDeps().scanner, () => Promise.resolve(), () => 0);
}

/** One change of the history, by `author` (left out for none), of the fields named. */
function change(fields: readonly string[], author?: TrustAuthor): object {
  return { ...(author === undefined ? {} : { author }), items: fields.map((fieldId) => ({ field: fieldId, fieldId })) };
}

function history(values: readonly object[], more: { isLast?: boolean; total?: number } = { isLast: true }): string {
  return JSON.stringify({ values, ...more });
}

const COLLEAGUE: TrustAuthor = { accountId: 'colleague', accountType: 'atlassian' };
const CUSTOMER: TrustAuthor = { accountId: 'customer-1', accountType: 'customer' };

/** The default rule on a project the team proved closed: site accounts inside, edits by them only. */
function closedDefault(): ResolvedTrust {
  return resolveTrust({ inside: undefined, never: [], edits: undefined, projects: new Map() }, 'ENG', JIRA_TRUST_DEFAULTS, false, insideKey(project()));
}

describe('a Jira reporter as the trust rule reads it', () => {
  it('reads the account id and kind, an id Jira hides as empty, and no reporter as none', () => {
    assert.deepEqual(reporterOf({ fields: { reporter: { accountId: 'a-1', accountType: 'atlassian', displayName: 'A' } } }), { accountId: 'a-1', accountType: 'atlassian' });
    assert.deepEqual(reporterOf({ fields: { reporter: { displayName: 'Former user' } } }), { accountId: '', accountType: undefined });
    assert.equal(reporterOf({ fields: {} }), undefined);
    assert.equal(reporterOf('text'), undefined);
    assert.equal(trustAuthor(undefined), undefined);
  });

  it('names the config key that lets a project\'s people in', () => {
    assert.equal(insideKey(project()), 'connectors.jira.trust.projects.ENG.inside');
  });
});

describe("reading a Jira issue's edit history", () => {
  it('names who changed the summary or description, and no one for other fields', async () => {
    const http = new FakeHttp().answers('GET', changelog(0), 200, history([change(['summary'], COLLEAGUE), change(['status', 'labels'], CUSTOMER), change(['description'])]));
    assert.deepEqual(await readEditors(client(http), project(), 'ENG-1'), { kind: 'read', editors: [COLLEAGUE, { accountId: '', accountType: undefined }] });
  });

  it('reads page after page from where the last one ended, until Jira says it is the last or the total is reached', async () => {
    const http = new FakeHttp()
      .answers('GET', changelog(0), 200, history([change(['summary'], COLLEAGUE), change(['status'])], { isLast: false }))
      .answers('GET', changelog(2), 200, history([change(['description'], CUSTOMER)], { total: 3 }));
    assert.deepEqual(await readEditors(client(http), project(), 'ENG-1'), { kind: 'read', editors: [COLLEAGUE, CUSTOMER] });
    assert.equal(http.requests.length, 2);
  });

  it('ends on an empty page', async () => {
    const http = new FakeHttp().answers('GET', changelog(0), 200, history([], { isLast: false }));
    assert.deepEqual(await readEditors(client(http), project(), 'ENG-1'), { kind: 'read', editors: [] });
  });

  it('is unread past its page bound, on a failed or missing read, and on an answer that is no list of changes', async () => {
    const endless = new FakeHttp();
    for (let page = 0; page < MAX_CHANGELOG_PAGES; page += 1) {
      endless.answers('GET', changelog(page), 200, history([change(['status'])], { isLast: false }));
    }
    assert.deepEqual(await readEditors(client(endless), project(), 'ENG-1'), { kind: 'unread', why: `ENG-1's edit history runs past the ${MAX_CHANGELOG_PAGES * CHANGELOG_PAGE} changes one read takes` });
    assert.deepEqual(await readEditors(client(new FakeHttp().answers('GET', changelog(0), 404)), project(), 'ENG-1'), { kind: 'unread', why: 'Jira gave no edit history of ENG-1' });
    const broken = await readEditors(client(new FakeHttp().answers('GET', changelog(0), 500)), project(), 'ENG-1');
    assert.equal(broken.kind, 'unread');
    assert.match(broken.kind === 'unread' ? broken.why : '', /^the read of ENG-1's edit history failed: Jira answered 500/);
    const notChanges = { kind: 'unread', why: "Jira's answer for ENG-1's edit history did not read as a list of changes" };
    assert.deepEqual(await readEditors(client(new FakeHttp().answers('GET', changelog(0), 200, '{"values":"x"}')), project(), 'ENG-1'), notChanges);
    assert.deepEqual(await readEditors(client(new FakeHttp().answers('GET', changelog(0), 200, '{"values":[{"items":"x"}]}')), project(), 'ENG-1'), notChanges);
  });
});

describe('judging a Jira issue', () => {
  it('trusts a site account reporter whose text only inside accounts edited', async () => {
    const http = new FakeHttp().answers('GET', changelog(0), 200, history([change(['summary'], COLLEAGUE)]));
    assert.deepEqual(await judgeIssue(client(http), closedDefault(), project(), 'ENG-1', COLLEAGUE), { trusted: true, why: 'the reporter matches inside (accountType atlassian)' });
  });

  it("drops trust when someone outside edited the text, or the history could not be read whole", async () => {
    const edited = new FakeHttp().answers('GET', changelog(0), 200, history([change(['description'], CUSTOMER)]));
    assert.deepEqual(await judgeIssue(client(edited), closedDefault(), project(), 'ENG-1', COLLEAGUE), {
      trusted: false,
      why: 'its title or body was edited by customer-1, who is not inside',
      failed: undefined,
    });
    const gone = await judgeIssue(client(new FakeHttp().answers('GET', changelog(0), 404)), closedDefault(), project(), 'ENG-1', COLLEAGUE);
    assert.deepEqual(gone, { trusted: false, why: 'its edit history could not be read whole', failed: 'Jira gave no edit history of ENG-1' });
  });

  it("reads no history for an outsider's issue, nor when edits by anyone keep trust", async () => {
    const http = new FakeHttp();
    const outsider = await judgeIssue(client(http), closedDefault(), project(), 'ENG-1', CUSTOMER);
    assert.deepEqual(outsider, { trusted: false, why: 'the reporter (customer account) matches no inside', failed: undefined });
    const anyEdits = resolveTrust({ inside: undefined, never: [], edits: 'any', projects: new Map() }, 'ENG', JIRA_TRUST_DEFAULTS, false, insideKey(project()));
    assert.equal((await judgeIssue(client(http), anyEdits, project(), 'ENG-1', COLLEAGUE)).trusted, true);
    assert.deepEqual(http.requests, []);
  });
});
