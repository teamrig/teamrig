import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LoggedCommit } from './leftovers.ts';
import { TEAMRIG_REGENERATION, planReplay, workPathspec, type ReplayPlan } from './regenerate.ts';
import { formatVersion } from './version-bump.ts';

/*
 * planReplay only reads git (log, show, diff), so its rules run here on a fake git; catch-up.test.ts keeps the real-git
 * proofs that those reads parse what git prints, and that a refusal leaves the repo dir as it was (T5032).
 */

const PLUGIN = 'plugins/teamrig/.claude-plugin/plugin.json';
const KIT = 'src/core/version.ts';
const RELEASE = '.release-please-manifest.json';
const DIST_FILE = 'plugins/teamrig/dist/a.js';

/** A full sha made of one hex digit, so each commit's is told apart at a glance. */
const shaOf = (digit: string): string => digit.repeat(40);
const BASE = shaOf('b');
const TIP = shaOf('c');

/** The files that carry a version, at the plugin version `version` and the release manifest at `released`. */
function versionsAt(version: string, released = '0.0.5'): Readonly<Record<string, string>> {
  return { [PLUGIN]: `{\n  "name": "teamrig",\n  "version": "${version}"\n}\n`, [KIT]: `export const KIT_VERSION = '${version}';\n`, [RELEASE]: `{\n  ".": "${released}"\n}\n` };
}

interface Change {
  /** The change's commits from the base, oldest first; the last is its head. */
  readonly commits: readonly LoggedCommit[];
  /** The version files at the change's head. */
  readonly head: Readonly<Record<string, string>>;
  /** What main's tip carries: 0.2.0 unless given. */
  readonly tip?: Readonly<Record<string, string>>;
  /** `git diff --unified=0` of the work from the base to the head. */
  readonly workDiff?: string;
}

const commit = (digit: string, files: readonly string[], parents: readonly string[] = [BASE]): LoggedCommit => ({ sha: shaOf(digit), parents, files });
const messageOf = (sha: string): string => `the message of ${sha.slice(0, 7)}\n`;

/** git in a repo where the change `BASE..head` sits on the base at 0.1.0; a call it does not expect throws. */
function fakeGit(change: Change): { readonly git: (...args: string[]) => string; readonly head: string } {
  const head = change.commits.at(-1)?.sha ?? BASE;
  const files: Readonly<Record<string, Readonly<Record<string, string>>>> = { [BASE]: versionsAt('0.1.0'), [head]: change.head, [TIP]: change.tip ?? versionsAt('0.2.0') };
  const log = change.commits.map((logged) => `\0${[logged.sha, ...logged.parents].join(' ')}\n${logged.files.join('\n')}\n`).join('');
  const workDiff = ['diff', '--unified=0', '--no-color', '--no-ext-diff', '--no-renames', BASE, head, '--', ...workPathspec(TEAMRIG_REGENERATION)].join(' ');
  const git = (...args: string[]): string => {
    const key = args.join(' ');
    if (key === `log --reverse --format=%x00%H %P --name-only ${BASE}..${head}`) return log;
    if (key === workDiff) return change.workDiff ?? '';
    const [command = '', first = '', second = '', third = ''] = args;
    if (command === 'log' && first === '-1' && second === '--format=%B') return messageOf(third);
    if (command === 'show' && args.length === 2) {
      const at = first.indexOf(':');
      const text = files[first.slice(0, at)]?.[first.slice(at + 1)];
      if (text !== undefined) return text;
    }
    throw new Error(`unexpected git ${key}`);
  };
  return { git, head };
}

const planOf = (change: Change): ReplayPlan | string => {
  const { git, head } = fakeGit(change);
  return planReplay(git, TEAMRIG_REGENERATION, BASE, head, TIP);
};

/** The plan with its versions written out, so a mismatch reads as text. */
const shown = (plan: ReplayPlan | string): unknown =>
  typeof plan === 'string'
    ? plan
    : { ...plan, raise: plan.raise && { ...plan.raise, set: formatVersion(plan.raise.set) }, follow: plan.follow && { ...plan.follow, files: plan.follow.files.map((file) => file.path), set: formatVersion(plan.follow.set) } };

test('a change of work, a raise and a dist replays its work and makes the raise again with its kind and message, then the dist (T2988)', () => {
  const plan = planOf({ commits: [commit('1', ['src/a.ts']), commit('2', [PLUGIN, KIT], [shaOf('1')]), commit('3', [DIST_FILE], [shaOf('2')])], head: versionsAt('0.1.1') });
  assert.deepEqual(shown(plan), { work: [shaOf('1')], raise: { kind: 'patch', set: '0.1.1', message: messageOf(shaOf('2')) }, follow: null, rebuild: true });
});

test('a change of work alone replays it and makes nothing again (T2988)', () => {
  assert.deepEqual(shown(planOf({ commits: [commit('1', ['tools/x.ts'])], head: versionsAt('0.1.0') })), { work: [shaOf('1')], raise: null, follow: null, rebuild: false });
});

test('a minor raise is made again as a minor raise (T2988)', () => {
  const plan = planOf({ commits: [commit('1', ['src/a.ts']), commit('2', [PLUGIN, KIT], [shaOf('1')])], head: versionsAt('0.2.0') });
  assert.equal(typeof plan === 'string' ? plan : plan.raise?.kind, 'minor');
});

test('a merge commit in the change is refused, as it is not replayed (T2988)', () => {
  assert.equal(planOf({ commits: [commit('1', ['src/a.ts']), commit('2', ['src/b.ts'], [shaOf('1'), TIP])], head: versionsAt('0.1.0') }), `it holds the merge commit ${shaOf('2').slice(0, 9)}, which is not replayed`);
});

test('a commit that mixes work with the version files or the dist is refused (T2988)', () => {
  for (const regenerated of [KIT, DIST_FILE]) {
    assert.equal(planOf({ commits: [commit('1', ['src/a.ts', regenerated])], head: versionsAt('0.1.1') }), `its commit ${shaOf('1').slice(0, 9)} changes the version files or the dist together with its work, so they cannot be made again apart`);
  }
});

test('a version file changed with no raise is refused (T2988)', () => {
  const plan = planOf({ commits: [commit('1', ['src/a.ts']), commit('2', [PLUGIN], [shaOf('1')])], head: versionsAt('0.1.0') });
  assert.equal(plan, `its commit ${shaOf('2').slice(0, 9)} changes a version file without raising the version 0.1.0`);
});

/** A work diff that adds `line` to docs/news.md, as `git diff --unified=0` prints it. */
const addedToNews = (line: string): string => ['diff --git a/docs/news.md b/docs/news.md', 'new file mode 100644', '--- /dev/null', '+++ b/docs/news.md', '@@ -0,0 +1 @@', `+${line}`].join('\n');
const RAISED_WITH_NEWS = [commit('1', ['src/a.ts', 'docs/news.md']), commit('2', [PLUGIN, KIT], [shaOf('1')])];

test("work that names the version it raised to is refused when main's raise sets another (T2988)", () => {
  const plan = planOf({ commits: RAISED_WITH_NEWS, head: versionsAt('0.1.1'), workDiff: addedToNews('New in 0.1.1: a is 2.') });
  assert.equal(plan, 'its work names the version 0.1.1 it raised to (docs/news.md), which becomes 0.2.1 on that tip');
});

test('work that names the version it raised to replays when the raise on the tip sets that same version, or names another (T2988)', () => {
  const replayed = { work: [shaOf('1')], raise: { kind: 'patch', set: '0.1.1', message: messageOf(shaOf('2')) }, follow: null, rebuild: false };
  assert.deepEqual(shown(planOf({ commits: RAISED_WITH_NEWS, head: versionsAt('0.1.1'), tip: versionsAt('0.1.0'), workDiff: addedToNews('New in 0.1.1: a is 2.') })), replayed, 'main did not move its version');
  assert.deepEqual(shown(planOf({ commits: RAISED_WITH_NEWS, head: versionsAt('0.1.1'), workDiff: addedToNews('Since 0.0.9: a is 2.') })), replayed, 'a mention of another version');
});

test("a release manifest the change set to its plugin version, in a commit of its own, is set again with that commit's message (T4298)", () => {
  const plan = planOf({ commits: [commit('1', ['tools/x.ts']), commit('2', [RELEASE], [shaOf('1')])], head: versionsAt('0.1.0', '0.1.0') });
  assert.deepEqual(shown(plan), { work: [shaOf('1')], raise: null, follow: { files: [RELEASE], set: '0.1.0', message: messageOf(shaOf('2')) }, rebuild: false });
});

test('a release manifest set in the raise commit, or to another version than the plugin version, is refused (T4298)', () => {
  assert.equal(
    planOf({ commits: [commit('1', ['tools/x.ts']), commit('2', [PLUGIN, KIT, RELEASE], [shaOf('1')])], head: versionsAt('0.1.1', '0.1.1') }),
    `its commit ${shaOf('2').slice(0, 9)} raises the version and sets .release-please-manifest.json together, so they cannot be made again apart`,
  );
  assert.equal(planOf({ commits: [commit('1', ['tools/x.ts']), commit('2', [RELEASE], [shaOf('1')])], head: versionsAt('0.1.0', '0.0.7') }), "its .release-please-manifest.json holds 0.0.7, not its plugin version 0.1.0, so it cannot be set again on that tip's");
});
