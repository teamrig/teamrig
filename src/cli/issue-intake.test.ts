import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { JsonRecord } from '../core/guards.ts';
import { isPullFilesRead } from '../adapters/connectors/github/gh.ts';
import { intakeReplyTitle } from '../sync/intake.ts';
import { CliHarness, EVENTS_PATH, TEAM } from '../testing/cli-harness.ts';
import { FakeGh } from '../testing/fake-gh.ts';
import { treeHarness } from '../testing/team-tree.ts';
import { EXIT } from './runtime.ts';

const REPLY = intakeReplyTitle({ repo: 'acme/web', number: 7 });
const AREAS = {
  repos: ['acme/web'],
  areaOwners: { 'area:guard': 'alpha', 'area:docs': 'bravo' },
  areaPaths: { 'area:guard': ['src/guard/**'], 'area:docs': ['docs/**'] },
};
const GUARDED = { reviewPaths: [{ glob: 'src/guard/**', mode: 'always', class: 'security' }] };
const INTAKE_TEAM: JsonRecord = { ...TEAM, roles: { lead: 'lead', securityReviewer: 'bravo' }, github: AREAS, pushGuard: GUARDED };
const AS_LEAD = { env: { TEAMRIG_SESSION: 'lead' } };
const INTAKE = ['issue', 'intake', 'acme/web#7', '--priority', 'p2'];

/** The register event that names `title`, as one JSON text. */
function eventOf(kit: CliHarness, title: string): string {
  const line = (kit.files.get(EVENTS_PATH) ?? '').split('\n').find((text) => text.includes(JSON.stringify(title)));
  assert.ok(line !== undefined, `no event names ${title}`);
  return line;
}

describe('teamrig issue intake (T3187)', () => {
  it("asks each area owner and the security reviewer a review task, then adds the caller's reply after them all", async () => {
    const kit = new CliHarness(INTAKE_TEAM);
    const gh = new FakeGh().pullFiles('acme/web#7', ['src/guard/a.ts', 'docs/b.md', 'README.md']);
    const result = await kit.run(INTAKE, { ...AS_LEAD, gh });
    const printed = [...result.stdout, ...result.stderr].join('\n');
    assert.equal(result.code, EXIT.ok, printed);
    assert.deepEqual(gh.ran.map((request) => isPullFilesRead(request.args)), [true]);
    const added = result.stdout.filter((line) => line.startsWith('ADDED '));
    assert.equal(added.length, 4, printed);
    assert.match(added[0] ?? '', /^ADDED T1 .*Best-fix and overlap review of outside PR acme\/web#7/u);
    assert.match(added[1] ?? '', /^ADDED T2 .*Best-fix and overlap review of outside PR acme\/web#7/u);
    assert.match(added[2] ?? '', /^ADDED T3 .*Security review of outside PR acme\/web#7/u);
    assert.match(added[3] ?? '', /^ADDED T4 .*Reply to outside PR acme\/web#7/u);
    const reply = eventOf(kit, REPLY);
    assert.ok(reply.includes('"after":["T1","T2","T3"]'), reply);
    assert.ok(reply.includes('"owner":"lead"') && reply.includes(JSON.stringify('README.md').slice(1, -1)), reply);
  });

  it('refuses a pull request taken in already, writing nothing more, until its reply is dropped, then keeps its open reviews', async () => {
    const kit = new CliHarness(INTAKE_TEAM);
    const gh = new FakeGh().pullFiles('acme/web#7', ['docs/b.md']);
    assert.equal((await kit.run(INTAKE, { ...AS_LEAD, gh })).code, EXIT.ok);
    const log = kit.files.get(EVENTS_PATH);
    const again = await kit.run(INTAKE, { ...AS_LEAD, gh });
    assert.equal(again.code, EXIT.refused);
    assert.match(again.stdout.join('\n'), /^REFUSED acme\/web#7 is taken in already: T2 answers its author/u);
    assert.equal(kit.files.get(EVENTS_PATH), log);
    const dropped = await kit.run(['set', 'T2', '--status', 'dropped', '--note', 'author closed it'], AS_LEAD);
    assert.equal(dropped.code, EXIT.ok, [...dropped.stdout, ...dropped.stderr].join('\n'));
    const retaken = await kit.run(INTAKE, { ...AS_LEAD, gh });
    assert.equal(retaken.code, EXIT.ok, [...retaken.stdout, ...retaken.stderr].join('\n'));
    assert.match(retaken.stdout[0] ?? '', /^KEPT T1 open, owner bravo \| Best-fix and overlap review of outside PR acme\/web#7 for bravo$/u);
    assert.match(retaken.stdout[1] ?? '', /^ADDED T3 open, .*after T1, .*Reply to outside PR acme\/web#7/u);
  });

  it('routes a renamed file by its earlier path too: a guarded file moved out of its folder asks its area and security', async () => {
    const kit = new CliHarness(INTAKE_TEAM);
    const result = await kit.run(INTAKE, { ...AS_LEAD, gh: new FakeGh().pullFiles('acme/web#7', [{ filename: 'README.md', from: 'src/guard/a.ts' }]) });
    const printed = [...result.stdout, ...result.stderr].join('\n');
    assert.equal(result.code, EXIT.ok, printed);
    const added = result.stdout.filter((line) => line.startsWith('ADDED '));
    assert.match(added[0] ?? '', /owner alpha, .*Best-fix and overlap review of outside PR acme\/web#7 for alpha/u, printed);
    assert.match(added[1] ?? '', /owner bravo, .*Security review of outside PR acme\/web#7/u, printed);
    assert.ok(eventOf(kit, 'Security review of outside PR acme/web#7').includes(JSON.stringify('src/guard/a.ts').slice(1, -1)));
  });

  it('adds only the reply, holding every path, when no area holds one and none is guarded', async () => {
    const kit = new CliHarness({ ...TEAM, github: { repos: ['acme/web'] } });
    const result = await kit.run(INTAKE, { ...AS_LEAD, gh: new FakeGh().pullFiles('acme/web#7', ['README.md']) });
    assert.equal(result.code, EXIT.ok, [...result.stdout, ...result.stderr].join('\n'));
    assert.equal(result.stdout.filter((line) => line.startsWith('ADDED ')).length, 1);
    assert.ok(!eventOf(kit, REPLY).includes('"after"'));
  });

  it('writes nothing when the read fails, and refuses with no read a missing priority or a repository not listed', async () => {
    const kit = new CliHarness(INTAKE_TEAM);
    const log = kit.files.get(EVENTS_PATH);
    const failed = await kit.run(INTAKE, { ...AS_LEAD, gh: new FakeGh() });
    assert.equal(failed.code, EXIT.failed);
    assert.match(failed.stderr.join('\n'), /^FAILED GitHub shows no pull request acme\/web#7/u);
    assert.equal(kit.files.get(EVENTS_PATH), log);
    const gh = new FakeGh();
    assert.match((await kit.run(['issue', 'intake', 'acme/web#7'], { ...AS_LEAD, gh })).stderr.join('\n'), /--priority is required/u);
    assert.equal((await kit.run(['issue', 'intake', 'acme/api#7', '--priority', 'p2'], { ...AS_LEAD, gh })).code, EXIT.refused);
    assert.deepEqual(gh.ran, []);
  });

  it("asks a security reviewer on another team of the tree in that team's register, the reply after it", async () => {
    const kit = await treeHarness({ roles: { lead: 'lead', securityReviewer: 'ops/run' }, github: { repos: ['acme/web'] }, pushGuard: GUARDED });
    const result = await kit.run(INTAKE, { ...AS_LEAD, gh: new FakeGh().pullFiles('acme/web#7', ['src/guard/a.ts']) });
    const printed = [...result.stdout, ...result.stderr].join('\n');
    assert.equal(result.code, EXIT.ok, printed);
    const asked = result.stdout.find((line) => line.startsWith('ADDED ops/T'));
    assert.match(asked ?? '', /^ADDED ops\/T(\d+) .*Security review of outside PR acme\/web#7/u, printed);
    const id = /^ADDED ops\/(T\d+)/u.exec(asked ?? '')?.[1] ?? '';
    assert.ok(eventOf(kit, REPLY).includes(`"after":["${id}"]`), eventOf(kit, REPLY));
  });
});
