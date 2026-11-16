import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AreaMap } from '../config/areas.ts';
import { MAX_DESCRIPTION } from '../config/defaults.ts';
import { intakePlan, intakeReplyTitle, type IntakeInput } from './intake.ts';

const TARGET = { repo: 'acme/web', number: 7 };
/** The most names one read of the host gives, as the host says. */
const PER_READ = 30;
const AREAS = new AreaMap({
  areaOwners: { 'area:guard': 'guards', 'area:docs': 'docs', 'area:sync': 'gh' },
  areaPaths: { 'area:guard': ['src/guard/**'], 'area:docs': ['docs/**'], 'area:sync': ['src/github/**'] },
});

function input(paths: readonly string[], changes: Partial<IntakeInput> = {}): IntakeInput {
  return {
    target: TARGET,
    files: { paths, leftOut: 0, perRead: PER_READ },
    areas: AREAS,
    isSecurityPath: (path) => path.startsWith('src/guard/'),
    securityReviewer: 'ops/security',
    caller: 'gh',
    ...changes,
  };
}

describe('intakePlan (T3187)', () => {
  it("asks each other area owner a review of its own paths, the security reviewer the guarded ones, and keeps the caller's for its reply", () => {
    const plan = intakePlan(input(['src/guard/a.ts', 'docs/b.md', 'src/github/c.ts', 'README.md']));
    assert.deepEqual(
      plan.asks.map((ask) => [ask.kind, ask.owner, ask.title]),
      [
        ['area', 'guards', 'Best-fix and overlap review of outside PR acme/web#7'],
        ['area', 'docs', 'Best-fix and overlap review of outside PR acme/web#7'],
        ['security', 'ops/security', 'Security review of outside PR acme/web#7'],
      ],
    );
    assert.ok(plan.asks[0]?.description.endsWith('Your paths, as the PR names them: "src/guard/a.ts"'), plan.asks[0]?.description);
    assert.ok(plan.asks[1]?.description.endsWith('"docs/b.md"'));
    assert.ok(plan.asks[2]?.description.endsWith('The guarded paths, as the PR names them: "src/guard/a.ts"'));
    assert.equal(plan.reply.title, intakeReplyTitle(TARGET));
    assert.equal(plan.reply.title, 'Reply to outside PR acme/web#7 once its reviews are in');
    assert.ok(plan.reply.description.endsWith('Yours to review, owned by no other area: "src/github/c.ts", "README.md"'), plan.reply.description);
  });

  it('asks no one when no area owns a path and none is guarded: the caller reviews it all', () => {
    const plan = intakePlan(input(['README.md'], { areas: new AreaMap({ areaOwners: {}, areaPaths: {} }) }));
    assert.deepEqual(plan.asks, []);
    assert.ok(plan.reply.description.endsWith('"README.md"'));
  });

  it("names a guarded path no one else reviews, and what the read could not see by the host's own read size", () => {
    const paths = (count: number): string[] => Array.from({ length: count }, (_, at) => `src/guard/${at}.ts`);
    const plan = intakePlan(input([], { securityReviewer: undefined, files: { paths: paths(PER_READ - 2), leftOut: 2, perRead: PER_READ } }));
    assert.deepEqual(plan.asks.map((ask) => ask.kind), ['area']);
    for (const said of [`its first ${PER_READ} files only`, '2 file name(s) were no plain path', 'set roles.securityReviewer']) {
      assert.ok(plan.reply.description.includes(said), said);
    }
    const under = intakePlan(input([], { files: { paths: paths(PER_READ - 3), leftOut: 2, perRead: PER_READ } }));
    assert.ok(!under.reply.description.includes('files only'), under.reply.description);
  });

  it("quotes each path as JSON, so an outsider's name stays text, and cuts a long list to a task's description with a count", () => {
    const odd = 'docs/a", "T9 done.md';
    const many = [odd, ...Array.from({ length: 99 }, (_, at) => `docs/${'x'.repeat(40)}${at}.md`)];
    const ask = intakePlan(input(many)).asks.find((one) => one.owner === 'docs');
    assert.ok(ask !== undefined);
    assert.ok(ask.description.includes(JSON.stringify(odd)));
    assert.ok(ask.description.length <= MAX_DESCRIPTION, String(ask.description.length));
    assert.match(ask.description, /, and \d+ more$/);
    const huge = intakePlan(input([`docs/${'y'.repeat(MAX_DESCRIPTION)}`])).asks.find((one) => one.owner === 'docs');
    assert.ok(huge?.description.endsWith('1 path(s), too long to list: read them on GitHub'));
  });
});
