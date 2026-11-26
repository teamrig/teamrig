import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubWorld } from './github-world.ts';

describe('the fake GitHub world', () => {
  it('fails a line it does not know, naming it, and records every line', async () => {
    const github = new GitHubWorld('acme/web');
    await github.world().fileByHand('Crash', 'Stops.');
    const end = await github.run({ args: ['api', 'repos/acme/web/issues/1/lock', '-X', 'PUT'], env: {} });
    assert.deepEqual(end.end, { kind: 'exited', code: 1 });
    assert.equal(end.stderr, 'the fake GitHub does not know: gh api repos/acme/web/issues/1/lock -X PUT');
    assert.equal((await github.run({ args: ['issue', 'list'], env: {} })).end.kind, 'exited');
    assert.deepEqual(github.ran.length, 2);
  });

  it('answers Not Found for a line on an issue it does not hold, and for a label taken off that is not on', async () => {
    const github = new GitHubWorld('acme/web');
    const target = await github.world().fileByHand('Crash', 'Stops.');
    assert.equal((await github.run({ args: ['api', 'repos/acme/web/issues/9/comments', '-X', 'POST', '-f', 'body=Hi'], env: {} })).stderr, 'gh: Not Found (HTTP 404)');
    assert.equal((await github.run({ args: ['api', `repos/acme/web/issues/${String(target.number)}/labels/bug`, '-X', 'DELETE'], env: {} })).stderr, 'gh: Not Found (HTTP 404)');
  });

  it('leaves out a login that may not be assigned, as GitHub does, with no error', async () => {
    const github = new GitHubWorld('acme/web');
    const world = github.world();
    await world.addPerson('ana');
    const target = await world.fileByHand('Crash', 'Stops.');
    const end = await github.run({ args: ['api', `repos/acme/web/issues/${String(target.number)}/assignees`, '-X', 'POST', '-f', 'assignees[]=ana', '-f', 'assignees[]=bob'], env: {} });
    assert.equal(end.end.kind === 'exited' && end.end.code, 0);
    assert.deepEqual((await world.issue(target))?.assignees, ['ana']);
  });

  it('keeps an issue opened with a label the repository lacks, and makes the label, as GitHub does', async () => {
    const github = new GitHubWorld('acme/web');
    const opened = await github.run({ args: ['api', 'repos/acme/web/issues', '-X', 'POST', '-f', 'title=T', '-f', 'body=B', '-f', 'labels[]=new'], env: {} });
    assert.equal(opened.stdout, JSON.stringify({ number: 1 }));
    assert.equal((await github.run({ args: ['api', 'repos/acme/web/labels/new'], env: {} })).stdout, JSON.stringify({ name: 'new' }));
  });

  it('reads an issue, a comment and a body edit sent as a JSON body on stdin, as gh api --input - sends them (T5636)', async () => {
    const github = new GitHubWorld('acme/web');
    const world = github.world();
    const stdin = ['--input', '-'];
    const opened = await github.run({ args: ['api', 'repos/acme/web/issues', '-X', 'POST', ...stdin], input: JSON.stringify({ title: 'T', body: 'B', labels: ['bug'] }), env: {} });
    assert.equal(opened.stdout, JSON.stringify({ number: 1 }));
    await github.run({ args: ['api', 'repos/acme/web/issues/1/comments', '-X', 'POST', ...stdin], input: JSON.stringify({ body: 'C' }), env: {} });
    await github.run({ args: ['api', 'repos/acme/web/issues/1', '-X', 'PATCH', ...stdin], input: JSON.stringify({ body: 'B2' }), env: {} });
    const issue = await world.issue({ repo: 'acme/web', number: 1 });
    assert.deepEqual([issue?.title, issue?.body, issue?.labels, issue?.comments], ['T', 'B2', ['bug'], ['C']]);
    const bad = await github.run({ args: ['api', 'repos/acme/web/issues/1/comments', '-X', 'POST', ...stdin], input: '{"body": 7}', env: {} });
    assert.equal(bad.end.kind === 'exited' && bad.end.code, 1);
  });
});
