import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AreaMap, splitAreaGlob } from './areas.ts';

const SESSIONS = ['lead', 'guards', 'gh', 'docs'];

/** An area labelled `area:<session>` per session given, in the team's order, holding its globs. */
function map(areas: Record<string, readonly string[]>): AreaMap {
  const owned = SESSIONS.filter((session) => Object.hasOwn(areas, session));
  return new AreaMap({
    areaOwners: Object.fromEntries(owned.map((session) => [`area:${session}`, session])),
    areaPaths: Object.fromEntries(owned.map((session) => [`area:${session}`, areas[session] ?? []])),
  });
}

describe('splitAreaGlob', () => {
  it('reads an owner/name: prefix as the repository, lowercase, and anything else as a glob of every repository', () => {
    assert.deepEqual(splitAreaGlob('Acme/Web:src/**'), { repo: 'acme/web', glob: 'src/**' });
    assert.deepEqual(splitAreaGlob('src/guard/**'), { repo: undefined, glob: 'src/guard/**' });
    assert.deepEqual(splitAreaGlob('acme:src/**'), { repo: undefined, glob: 'acme:src/**' });
    assert.deepEqual(splitAreaGlob('acme/web:'), { repo: 'acme/web', glob: '' });
  });
});

describe('AreaMap', () => {
  it('gives a path to the owner of each area whose glob covers it, in the order of github.areaOwners, and a bare name at any depth', () => {
    const areas = map({ docs: ['docs/**', '*.md'], guards: ['src/push-guard/**'] });
    assert.deepEqual(areas.ownersOf('acme/web', 'src/push-guard/rules.ts'), ['guards']);
    assert.deepEqual(areas.ownersOf('acme/web', 'docs/guides/README.md'), ['docs']);
    assert.deepEqual(areas.ownersOf('acme/web', 'src/push-guard/README.md'), ['guards', 'docs']);
    assert.deepEqual(areas.ownersOf('acme/web', 'src/cli/run.ts'), []);
  });

  it('holds a prefixed glob to its repository, in any case, and an unprefixed one to every repository', () => {
    const areas = map({ gh: ['acme/web:src/**'], guards: ['src/guard/**'] });
    assert.deepEqual(areas.ownersOf('ACME/Web', 'src/a.ts'), ['gh']);
    assert.deepEqual(areas.ownersOf('acme/api', 'src/a.ts'), []);
    assert.deepEqual(areas.ownersOf('acme/api', 'src/guard/a.ts'), ['guards']);
  });

  it('splits paths into each owner with its share, in the order of github.areaOwners, and the paths no one owns', () => {
    const areas = map({ docs: ['docs/**'], guards: ['src/guard/**', 'docs/guard.md'] });
    assert.deepEqual(areas.split('acme/web', ['docs/guard.md', 'src/guard/a.ts', 'src/cli/b.ts', 'docs/x.md']), {
      owners: [
        { session: 'guards', paths: ['docs/guard.md', 'src/guard/a.ts'] },
        { session: 'docs', paths: ['docs/guard.md', 'docs/x.md'] },
      ],
      unowned: ['src/cli/b.ts'],
    });
  });

  it('owns nothing with no areas, and says so', () => {
    const areas = map({});
    assert.equal(areas.isEmpty, true);
    assert.deepEqual(areas.split('acme/web', ['src/a.ts']), { owners: [], unowned: ['src/a.ts'] });
    assert.equal(map({ docs: ['docs/**'] }).isEmpty, false);
  });

  it("asks a session owning two areas once, and holds nothing for a label with no owner or an owner's label with no paths", () => {
    const areas = new AreaMap({
      areaOwners: { 'area:cli': 'gh', 'area:sync': 'gh', 'area:docs': 'docs' },
      areaPaths: { 'area:cli': ['src/cli/**'], 'area:sync': ['src/github/**'], 'area:stray': ['src/**'] },
    });
    assert.deepEqual(areas.split('acme/web', ['src/cli/a.ts', 'src/github/b.ts', 'docs/c.md']), {
      owners: [{ session: 'gh', paths: ['src/cli/a.ts', 'src/github/b.ts'] }],
      unowned: ['docs/c.md'],
    });
  });

  it("reads a label named like an object's own member as a plain label, holding no paths it does not list", () => {
    const areas = new AreaMap({ areaOwners: { constructor: 'gh', tostring: 'docs' }, areaPaths: {} });
    assert.equal(areas.isEmpty, true);
    assert.deepEqual(areas.ownersOf('acme/web', 'src/a.ts'), []);
  });
});
