import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HttpResult } from '../core/http.ts';
import { JiraWorld } from './jira-world.ts';

const API = 'https://acme.atlassian.net/rest/api/3';

function status(result: HttpResult): number | string {
  return result.kind === 'answered' ? result.status : result.reason;
}

describe('the fake Jira world', () => {
  it('fails a request it does not know, naming it, and records every request', async () => {
    const jira = new JiraWorld('acme', 'ENG');
    await jira.world().fileByHand('Crash', 'Stops.');
    assert.equal(status(await jira.send({ method: 'DELETE', url: `${API}/issue/ENG-1` })), `the fake Jira does not know DELETE ${API}/issue/ENG-1`);
    assert.equal(status(await jira.send({ method: 'GET', url: 'https://other.atlassian.net/rest/api/3/myself' })), 'the fake Jira does not know GET https://other.atlassian.net/rest/api/3/myself');
    assert.equal(jira.requests.length, 2);
  });

  it('answers Not Found for an issue it does not hold, and refuses an issue of another project', async () => {
    const jira = new JiraWorld('acme', 'ENG');
    assert.equal(status(await jira.send({ method: 'GET', url: `${API}/issue/ENG-9?fields=status` })), 404);
    const other = JSON.stringify({ fields: { project: { key: 'OPS' }, summary: 'T', issuetype: { id: '10001' } } });
    assert.equal(status(await jira.send({ method: 'POST', url: `${API}/issue`, body: other })), 400);
  });

  it('refuses an account that may not be assigned, and a resolution its workflow does not offer', async () => {
    const jira = new JiraWorld('acme', 'ENG');
    const target = await jira.world().fileByHand('Crash', 'Stops.');
    const key = `${API}/issue/ENG-${String(target.number)}`;
    assert.equal(status(await jira.send({ method: 'PUT', url: `${key}/assignee`, body: JSON.stringify({ accountId: 'bob' }) })), 400);
    const closing = JSON.stringify({ transition: { id: '31' }, fields: { resolution: { id: '9' } } });
    assert.equal(status(await jira.send({ method: 'POST', url: `${key}/transitions`, body: closing })), 400);
    assert.deepEqual((await jira.world().issue(target))?.state, 'open');
  });

  it('closes an issue with no resolution when none is sent, so it reads as closed for no reason', async () => {
    const jira = new JiraWorld('acme', 'ENG');
    const target = await jira.world().fileByHand('Crash', 'Stops.');
    assert.equal(status(await jira.send({ method: 'POST', url: `${API}/issue/ENG-1/transitions`, body: JSON.stringify({ transition: { id: '31' } }) })), 204);
    const issue = await jira.world().issue(target);
    assert.deepEqual([issue?.state, issue?.reason], ['closed', undefined]);
  });
});
