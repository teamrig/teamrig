import { join } from 'node:path';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { EXIT, RefusedError } from '../../src/cli/runtime.ts';
import { mergeStandingOf, type MergeStanding } from '../../src/cli/ship-approval.ts';
import { CLAUDE_SESSION, CliHarness, TEAM, TEAM_HOME } from '../../src/testing/cli-harness.ts';
import { shippedHostGlobs } from './host-globs.ts';
import { TempRepo } from '../lib/temp-repo.ts';
import { type WorkCommit, workChanges } from '../../src/merge/work-commits.ts';
import { DEFAULT_SENSITIVE_PATHS } from '../../src/config/defaults.ts';
import { sensitivePathsOf } from '../../src/cli/approval-clearance.ts';
import {
  changedPathsOf,
  changePatch,
  clearMerge,
  clearMergeFrom,
  clearTaskMerge,
  clearTaskMergeFrom,
  mergeClearance,
  originRepoChanges,
  type ChangeReads,
  type MergeReads,
  shipWritesOf,
  type StandingOf,
  type TabCallerOf,
  taskBranchesOf,
  taskOfBranch,
  teamrigShipWritesOf,
  workCommitsOf,
} from './approval.ts';
import { profileFor, readProfiles } from './repos.ts';
import { TEAMRIG_RELEASE_MANIFEST, TEAMRIG_RELEASE_STAMPS, TEAMRIG_SHIP_VERSION_FILES, TEAMRIG_VERSION_FILES } from './version-bump.ts';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const MANIFEST = 'plugins/teamrig/.claude-plugin/plugin.json';
const VERSION_TS = 'src/core/version.ts';
/** A key a plugin manifest runs commands by, in every session that loads it. */
const HOOKS_KEY = ',\n  "hooks": "./hooks/hooks.json"';
const manifest = (version: string, more = ''): string => `{\n  "name": "teamrig",\n  "version": "${version}",\n  "description": "the kit"${more}\n}\n`;
const versionTs = (version: string): string => `/** The kit's version. */\nexport const KIT_VERSION = '${version}';\n`;
const MIGRATE_TS = 'src/config/migrate.ts';
const GUIDE = 'docs/guides/run.md';
/** A guide whose one line names the release that added its key. */
const GUIDE_BASE = '# Run\n\n- `open.idle.mode` (since 0.1.0) closes it.\n';
const SCHEMA = 'plugins/teamrig/config.schema.json';
/** A config migration from `from`, first read by release `release`. */
const migration = (from: number, release: string): string => `export const STEP_${from} = {\n  from: ${from},\n  firstRelease: '${release}',\n};\n`;

/** Team app with T1, alpha's, waiting on the lead's approval; `answer` is the lead's answer, if any. */
async function waitingKit(answer?: readonly string[]): Promise<CliHarness> {
  const kit = new CliHarness();
  assert.equal((await kit.run(['add', '--title', 'Ship the CLI', '--description', 'what and why', '--priority', 'p1', '--session', 'alpha'])).code, EXIT.ok);
  assert.equal((await kit.run(['set', 'T1', '--status', 'waiting', '--waits', 'approval:lead', '--note', 'branch t1-cli', '--session', 'alpha'])).code, EXIT.ok);
  if (answer !== undefined) {
    const run = await kit.run(['approve', 'T1', ...answer, '--session', 'lead']);
    assert.equal(run.code, EXIT.ok, run.stderr.join('\n'));
  }
  return kit;
}

const standing = async (kit: CliHarness, caller = 'alpha', hostGlobs: readonly string[] = []): Promise<MergeStanding> => mergeStandingOf(kit.runtime(), 'app', caller, 'T1', hostGlobs);
const approvedBy = async (note: string): Promise<MergeStanding> => standing(await waitingKit(['--note', note]));
const reasonOf = (clearance: ReturnType<typeof mergeClearance>): string => (clearance.kind === 'refused' ? clearance.reason : `not refused: ${clearance.kind}`);
/** A repo the clearance must never read: it decides before the answerer's clearance, or the caller is no answerer. */
const UNREAD: ChangeReads = {
  changedPaths: () => {
    throw new Error("the clearance read the head's paths");
  },
  taskBranches: () => {
    throw new Error("the clearance read the repo's branches");
  },
};
/** The hosts' repository globs for a clearance whose spec counts none of them. */
const NO_HOST_GLOBS = async (): Promise<readonly string[]> => [];
/**
 * A repo whose head changes `paths` and whose task branches (`refs/heads/t<n>-x`) change `branches[task]`, counting
 * the head's reads and listing every rev read.
 */
const pathsReader = (paths: readonly string[], branches: Readonly<Record<string, readonly string[]>> = {}): { read: ChangeReads; reads: () => number; revs: string[] } => {
  let reads = 0;
  const revs: string[] = [];
  const refOf = (task: string): string => `refs/heads/${task.toLowerCase()}-x`;
  return {
    read: {
      changedPaths: (rev) => {
        revs.push(rev);
        if (rev === HEAD) {
          reads += 1;
          return paths;
        }
        const task = Object.keys(branches).find((id) => refOf(id) === rev);
        return task === undefined ? [] : (branches[task] ?? []);
      },
      taskBranches: () => Object.keys(branches).map((task) => ({ task, ref: refOf(task) })),
    },
    reads: () => reads,
    revs,
  };
};
/**
 * The standing of `base` with alpha as the answerer, charlie as the security reviewer, and the given sensitive
 * globs carved out of the given low-risk ones.
 */
const answering = (
  base: MergeStanding,
  sensitive: readonly string[] = ['tools/**', '*guard*', 'package-lock.json', '.github/workflows/**', '*.sql'],
  lowRisk: readonly string[] = ['src/**', 'docs/**', 'README.md'],
): MergeStanding => ({
  ...base,
  answerer: 'alpha',
  securityReviewer: 'charlie',
  lowRisk,
  sensitive,
});
/** `base` with the unshipped tasks `open` names, by id to owner. */
const opening = (base: MergeStanding, open: Readonly<Record<string, string>>): MergeStanding => ({ ...base, open: new Map(Object.entries(open)) });

/**
 * Team app whose answerer is alpha and security reviewer charlie, with T1, alpha's, waiting on `approver`'s
 * approval, which `approver` gave naming `note`.
 */
async function answererKit(approver: string, note: string): Promise<CliHarness> {
  const kit = new CliHarness({ sessions: ['lead', 'alpha', 'bravo', 'charlie'], roles: { lead: 'lead', securityReviewer: 'charlie' }, github: { watcher: 'alpha' } });
  assert.equal((await kit.run(['add', '--title', 'Outside fix', '--description', 'what and why', '--priority', 'p1', '--session', 'alpha'])).code, EXIT.ok);
  const wait = await kit.run(['set', 'T1', '--status', 'waiting', '--waits', `approval:${approver}`, '--note', 'branch t1-fix', '--session', 'alpha']);
  assert.equal(wait.code, EXIT.ok, wait.stderr.join('\n'));
  const answer = await kit.run(['approve', 'T1', '--note', note, '--session', approver]);
  assert.equal(answer.code, EXIT.ok, answer.stderr.join('\n'));
  return kit;
}

describe('taskOfBranch', () => {
  it('reads the task from the t<id>- prefix, and none from any other name', () => {
    assert.equal(taskOfBranch('t2788-ship-approval'), 'T2788');
    assert.equal(taskOfBranch('t2693-conflict-hints-r5'), 'T2693');
    assert.equal(taskOfBranch('main'), null);
    assert.equal(taskOfBranch('fix-t12-thing'), null);
    assert.equal(taskOfBranch('t-12-thing'), null);
  });

  it('reads it from a part of the name, as delivery.branches names a branch, the way worktree remove does (T3193)', () => {
    assert.equal(taskOfBranch('fix/t3164-rate-fit-after-a-partial-reset-fits'), 'T3164');
    assert.equal(taskOfBranch('feat/t12-parser'), 'T12');
    assert.equal(taskOfBranch('team/feat/t7-thing'), 'T7');
    assert.equal(taskOfBranch('fix/x-t12-thing'), null);
  });
});

describe('mergeClearance: the merge needs its approver to have approved the head it merges (T2788)', () => {
  it('clears the head the lead approved, by a short or a full sha in its note', async () => {
    assert.deepEqual(mergeClearance(await approvedBy(`head ${HEAD.slice(0, 9)} checked`), 'T1', HEAD, HEAD.slice(0, 9), UNREAD), { kind: 'approved', by: 'lead' });
    assert.deepEqual(mergeClearance(await approvedBy(`approve ${HEAD}`), 'T1', HEAD, HEAD, UNREAD), { kind: 'approved', by: 'lead' });
  });

  it('refuses a task the register does not hold', async () => {
    const kit = await waitingKit(['--note', HEAD]);
    const clearance = mergeClearance(await mergeStandingOf(kit.runtime(), 'app', 'alpha', 'T9', []), 'T9', HEAD, HEAD, UNREAD);
    assert.match(reasonOf(clearance), /holds no task T9/);
  });

  it("refuses a caller merging another session's task, the lead too", async () => {
    const kit = await waitingKit(['--note', HEAD]);
    assert.match(reasonOf(mergeClearance(await standing(kit, 'bravo'), 'T1', HEAD, HEAD, UNREAD)), /T1 is alpha's: only its owner merges it, not bravo/);
    assert.match(reasonOf(mergeClearance(await standing(kit, 'lead'), 'T1', HEAD, null, UNREAD)), /only its owner merges it, not lead/);
  });

  it("clears a root team's lead on its own task with no --approved", async () => {
    const kit = new CliHarness();
    assert.equal((await kit.run(['add', '--title', 'Lead work', '--description', 'what and why', '--priority', 'p1', '--session', 'lead'])).code, EXIT.ok);
    assert.deepEqual(mergeClearance(await standing(kit, 'lead'), 'T1', HEAD, null, UNREAD), { kind: 'self' });
  });

  it('refuses a merge that names no approved head', async () => {
    assert.match(reasonOf(mergeClearance(await approvedBy(HEAD), 'T1', HEAD, null, UNREAD)), /--approved <sha>: alpha's merge needs the approval of lead/);
  });

  it('refuses --approved that is no sha, or not the branch head', async () => {
    const approved = await approvedBy(HEAD);
    assert.match(reasonOf(mergeClearance(approved, 'T1', HEAD, 'HEAD', UNREAD)), /--approved HEAD is not the branch head/);
    assert.match(reasonOf(mergeClearance(approved, 'T1', HEAD, '0123', UNREAD)), /is not the branch head/, 'too short to name a commit');
    assert.match(reasonOf(mergeClearance(approved, 'T1', HEAD, 'fedcba987', UNREAD)), /--approved fedcba987 is not the branch head/);
  });

  it('refuses a task with no approval: none asked, none given yet, or declined', async () => {
    const asked = new CliHarness();
    assert.equal((await asked.run(['add', '--title', 'Ship', '--description', 'what and why', '--priority', 'p1', '--session', 'alpha'])).code, EXIT.ok);
    assert.match(reasonOf(mergeClearance(await standing(asked), 'T1', HEAD, HEAD, UNREAD)), /T1 \(open\) holds no approval of lead: set it waiting approval:lead/);
    assert.match(reasonOf(mergeClearance(await standing(await waitingKit()), 'T1', HEAD, HEAD, UNREAD)), /T1 \(waiting\) holds no approval of lead/);
    assert.match(reasonOf(mergeClearance(await standing(await waitingKit(['--decline', '--note', HEAD])), 'T1', HEAD, HEAD, UNREAD)), /holds no approval of lead/);
  });

  it('refuses an approval whose note names another head, or no sha', async () => {
    const earlier = 'fedcba9876543210fedcba9876543210fedcba98';
    assert.match(reasonOf(mergeClearance(await approvedBy(`head ${earlier} checked`), 'T1', HEAD, HEAD, UNREAD)), /lead's approval of T1 names no sha of the head/);
    assert.match(reasonOf(mergeClearance(await approvedBy('looks good'), 'T1', HEAD, HEAD, UNREAD)), /names no sha of the head/);
    assert.match(reasonOf(mergeClearance(await approvedBy(`x${HEAD}`), 'T1', HEAD, HEAD, UNREAD)), /names no sha of the head/, 'a sha inside a longer word');
  });
});

describe('mergeClearance: the answerer approves a low-risk change alone (owner order, T3448)', () => {
  it('clears the answerer naming its own head when no changed path is sensitive, with no approval asked', async () => {
    const paths = pathsReader(['src/cli/list.ts', 'docs/commands.md', 'README.md']);
    assert.deepEqual(mergeClearance(answering(await standing(await waitingKit())), 'T1', HEAD, HEAD.slice(0, 9), paths.read), { kind: 'low-risk', by: 'alpha', paths: 3 });
    const open = new CliHarness();
    assert.equal((await open.run(['add', '--title', 'Outside fix', '--description', 'what and why', '--priority', 'p1', '--session', 'alpha'])).code, EXIT.ok);
    assert.deepEqual(mergeClearance(answering(await standing(open)), 'T1', HEAD, HEAD, paths.read), { kind: 'low-risk', by: 'alpha', paths: 3 }, 'an open task, never set waiting');
    assert.equal(paths.reads(), 2);
  });

  it("clears it over a declined or stale lead approval, and keeps the lead's approval of the head first", async () => {
    const paths = pathsReader(['src/a.ts']);
    assert.deepEqual(mergeClearance(answering(await approvedBy('head fedcba987 checked')), 'T1', HEAD, HEAD, paths.read), { kind: 'low-risk', by: 'alpha', paths: 1 });
    assert.deepEqual(mergeClearance(answering(await approvedBy(HEAD)), 'T1', HEAD, HEAD, UNREAD), { kind: 'approved', by: 'lead' }, 'the paths are not read');
  });

  it("asks the security reviewer's approval first when a changed path is sensitive, naming five and counting the rest", async () => {
    const base = answering(await standing(await waitingKit()));
    const one = mergeClearance(base, 'T1', HEAD, HEAD, pathsReader(['src/a.ts', 'tools/ship/ship.ts']).read);
    assert.equal(reasonOf(one), `T1 touches the sensitive tools/ship/ship.ts: set it waiting approval:charlie and ask charlie to approve it naming ${HEAD} (a leader's approval of it clears it too)`);
    for (const path of ['src/secret-guard.ts', 'package-lock.json', 'web/package-lock.json', '.github/workflows/ci.yml', 'db/Schema.SQL']) {
      assert.match(reasonOf(mergeClearance(base, 'T1', HEAD, HEAD, pathsReader([path]).read)), /approval:charlie/, path);
    }
    const many = ['tools/a', 'tools/b', 'tools/c', 'tools/d', 'tools/e', 'tools/f', 'tools/g'];
    assert.match(reasonOf(mergeClearance(base, 'T1', HEAD, HEAD, pathsReader(many).read)), /touches the sensitive tools\/a, tools\/b, tools\/c, tools\/d, tools\/e and 2 more: /);
  });

  it("clears a sensitive change once the security reviewer approved its head, and not an earlier one's", async () => {
    const paths = pathsReader(['tools/ship/ship.ts']);
    assert.deepEqual(mergeClearance(await standing(await answererKit('charlie', `passed ${HEAD.slice(0, 9)}`)), 'T1', HEAD, HEAD, paths.read), { kind: 'approved', by: 'charlie' });
    assert.match(reasonOf(mergeClearance(await standing(await answererKit('charlie', 'passed fedcba987')), 'T1', HEAD, HEAD, paths.read)), /approval:charlie/);
  });

  it('refuses a sensitive path of the team when no other session reviews security, and clears all when the team lists no glob', async () => {
    const team = answering(await standing(await waitingKit()), ['src/billing/**']);
    const unreviewed = { ...team, securityReviewer: undefined };
    assert.match(reasonOf(mergeClearance(unreviewed, 'T1', HEAD, HEAD, pathsReader(['src/billing/pay.ts']).read)), /holds no approval of lead: .*; it touches the sensitive src\/billing\/pay\.ts, and the team has no other security reviewer to pass it first$/);
    assert.match(reasonOf(mergeClearance({ ...team, securityReviewer: 'alpha' }, 'T1', HEAD, HEAD, pathsReader(['src/billing/pay.ts']).read)), /no other security reviewer/, 'the answerer passes not its own');
    assert.equal(mergeClearance(team, 'T1', HEAD, HEAD, pathsReader(['src/push-guard.ts']).read).kind, 'low-risk', 'the default list replaced');
  });

  it('asks the security reviewer for a path no low-risk glob names, a new folder, a skill or an agent rule (security verdict)', async () => {
    const base = answering(await standing(await waitingKit()));
    for (const path of ['lib/new.ts', 'plugins/teamrig/skills/guide/SKILL.md', 'CLAUDE.md', 'llms.txt', 'tools/x.ts']) {
      assert.match(reasonOf(mergeClearance(base, 'T1', HEAD, HEAD, pathsReader(['docs/a.md', path]).read)), new RegExp(`^T1 touches the sensitive ${path.replace(/\./g, '\\.')}: set it waiting approval:charlie`), path);
    }
    const none = answering(await standing(await waitingKit()), [], []);
    assert.match(reasonOf(mergeClearance(none, 'T1', HEAD, HEAD, pathsReader(['docs/a.md']).read)), /approval:charlie/, 'no low-risk glob: every path is sensitive');
  });

  it("asks the approval of the one session whose open branch changes a file the head changes too", async () => {
    const base = opening(answering(await standing(await waitingKit())), { T2: 'bravo', T5: 'bravo' });
    const repo = pathsReader(['src/a.ts', 'src/c.ts'], { T2: ['src/a.ts', 'src/b.ts'], T5: ['src/c.ts'] });
    assert.equal(reasonOf(mergeClearance(base, 'T1', HEAD, HEAD, repo.read)), `T1 touches src/a.ts, src/c.ts, which bravo's open T2, T5 change: set it waiting approval:bravo and ask bravo to approve it naming ${HEAD} (a leader's approval of it clears it too)`);
    assert.deepEqual(mergeClearance(answering(await standing(await answererKit('bravo', HEAD))), 'T1', HEAD, HEAD, pathsReader(['src/a.ts'], { T2: ['src/a.ts'] }).read).kind, 'low-risk', 'T2 is in no register here');
    const approved = opening(answering(await standing(await answererKit('bravo', HEAD))), { T2: 'bravo' });
    assert.deepEqual(mergeClearance(approved, 'T1', HEAD, HEAD, pathsReader(['src/a.ts'], { T2: ['src/a.ts'] }).read), { kind: 'approved', by: 'bravo' });
  });

  it("reads only other sessions' unshipped branches: not the caller's, the merging task's, a shipped or an unknown task's", async () => {
    const base = opening(answering(await standing(await waitingKit())), { T1: 'alpha', T4: 'alpha', T2: 'bravo' });
    const repo = pathsReader(['src/a.ts'], { T1: ['src/a.ts'], T4: ['src/a.ts'], T6: ['src/a.ts'], T2: ['src/b.ts'] });
    assert.deepEqual(mergeClearance(base, 'T1', HEAD, HEAD, repo.read), { kind: 'low-risk', by: 'alpha', paths: 1 });
    assert.deepEqual(repo.revs, [HEAD, 'refs/heads/t2-x'], "only bravo's T2 is read, and it changes no file of the head");
  });

  it('leaves to the leaders a head touching several sessions\' open branches, or a sensitive path and another session\'s branch', async () => {
    const base = opening(answering(await standing(await waitingKit())), { T2: 'bravo', T3: 'charlie' });
    const several = mergeClearance(base, 'T1', HEAD, HEAD, pathsReader(['src/a.ts', 'src/b.ts'], { T2: ['src/a.ts'], T3: ['src/b.ts'] }).read);
    assert.match(reasonOf(several), /^T1 \(waiting\) holds no approval of lead: .*; it touches files of several sessions' open branches \(src\/a\.ts, which bravo's open T2 changes; src\/b\.ts, which charlie's open T3 changes\), which the leaders approve$/);
    const both = mergeClearance(base, 'T1', HEAD, HEAD, pathsReader(['tools/x.ts', 'src/a.ts'], { T2: ['src/a.ts'] }).read);
    assert.match(reasonOf(both), /; it touches the sensitive tools\/x\.ts and src\/a\.ts, which bravo's open T2 changes, which the leaders approve$/);
    const reviewers = mergeClearance(base, 'T1', HEAD, HEAD, pathsReader(['tools/x.ts', 'src/b.ts'], { T3: ['src/b.ts'] }).read);
    assert.match(reasonOf(reviewers), /^T1 touches the sensitive tools\/x\.ts and src\/b\.ts, which charlie's open T3 changes: set it waiting approval:charlie/, "the reviewer's own branch: one approval");
  });

  it("refuses the answerer's --approved naming another sha or none, before reading any path", async () => {
    const base = answering(await standing(await waitingKit()));
    assert.match(reasonOf(mergeClearance(base, 'T1', HEAD, 'fedcba987', UNREAD)), /--approved fedcba987 is not the branch head/);
    assert.match(reasonOf(mergeClearance(base, 'T1', HEAD, null, UNREAD)), /--approved <sha>/);
  });

  it("refuses a caller that is not the answerer, without reading its paths, and the answerer on another's task", async () => {
    const kit = await waitingKit();
    assert.match(reasonOf(mergeClearance({ ...(await standing(kit)), answerer: 'bravo', sensitive: [] }, 'T1', HEAD, HEAD, UNREAD)), /^T1 \(waiting\) holds no approval of lead: set it waiting approval:lead and ask for it naming 0123/);
    assert.match(reasonOf(mergeClearance({ ...(await standing(kit, 'bravo')), answerer: 'bravo', sensitive: [] }, 'T1', HEAD, HEAD, UNREAD)), /T1 is alpha's: only its owner merges it, not bravo/);
  });
});

describe('taskBranchesOf: the local and origin branches named for a task', () => {
  it('reads both ref folders, keeping only a branch named for a task', () => {
    const asked: (readonly string[])[] = [];
    const git = (args: readonly string[]): string => {
      asked.push(args);
      return 'refs/heads/main\nrefs/heads/feat/t12-parser\nrefs/remotes/origin/HEAD\nrefs/remotes/origin/t5-fix\nrefs/remotes/origin/notes\n';
    };
    assert.deepEqual(taskBranchesOf(git), [
      { task: 'T12', ref: 'refs/heads/feat/t12-parser' },
      { task: 'T5', ref: 'refs/remotes/origin/t5-fix' },
    ]);
    assert.deepEqual(asked, [['for-each-ref', '--format=%(refname)', 'refs/heads/', 'refs/remotes/origin/']]);
  });
});

describe("originRepoChanges: the clearance's repo reads, by the profile of the repo origin names", () => {
  const fakeGit = (remote: string): { git: (args: readonly string[]) => string; asked: (readonly string[])[] } => {
    const asked: (readonly string[])[] = [];
    const answers: Readonly<Record<string, string>> = { remote: `${remote}\n`, 'for-each-ref': 'refs/heads/feat/t7-x\n', 'merge-base': 'base1\n', diff: 'src/a.ts\0' };
    return { asked, git: (args) => { asked.push(args); return answers[args[0] ?? ''] ?? ''; } };
  };

  it('reads nothing until a read, then the remote once, and the profile main and regenerated folders after', () => {
    const { git, asked } = fakeGit('https://github.com/GeneralA6/teamrig.git');
    const profiles = readProfiles();
    const { main, regenerated } = profileFor(profiles, 'GeneralA6/teamrig');
    const reads = originRepoChanges(git, profiles);
    assert.deepEqual(asked, []);

    assert.deepEqual(reads.taskBranches(), [{ task: 'T7', ref: 'refs/heads/feat/t7-x' }]);
    assert.deepEqual(reads.changedPaths('head1'), ['src/a.ts']);
    assert.deepEqual(asked.filter((args) => args[0] === 'remote'), [['remote', 'get-url', 'origin']]);
    assert.deepEqual(asked.find((args) => args[0] === 'merge-base'), ['merge-base', 'head1', `refs/remotes/origin/${main}`]);
    const diff: readonly string[] = asked.find((args) => args[0] === 'diff') ?? [];
    for (const folder of teamrigShipWritesOf(regenerated).generated) assert.ok(diff.some((arg) => arg.includes(folder)), `the diff leaves out ${folder}`);
  });

  it("refuses at the first read, not before, a repo repos.json lists no profile for", () => {
    const { git } = fakeGit('https://github.com/someone/elsewhere.git');
    const reads = originRepoChanges(git, readProfiles());
    assert.throws(() => reads.taskBranches(), /no check list for someone\/elsewhere/);
  });
});

describe("sensitivePathsOf: the security verdict's paths stay sensitive under the default lists (T3448)", () => {
  /** Every path the verdict found merging on the answerer's approval alone: the gate's own code, exec and secret code, and agent instructions. */
  const VERDICT = [
    ...['src/config/defaults.ts', 'src/config/parse.ts', 'src/config/roster.ts', 'src/register/approval.ts', 'src/register/policy.ts', 'src/register/review.ts'],
    ...['src/register/hand-step.ts', 'src/cli/ship-approval.ts', 'src/cli/approval-clearance.ts','src/worktree/owner.ts', 'src/exec/runner.ts', 'src/exec/client-integrity.ts', 'src/exec/redact.ts'],
    ...['src/cli/commands/exec.ts', 'src/core/secrets.ts', 'src/core/secret-key.ts', 'src/core/secret-patterns.ts', 'src/core/secret-shapes.ts'],
    ...['src/cli/commands/secret-rotation.ts', 'src/cli/commands/secrets.ts', 'src/cli/commands/audit.ts', 'src/cli/commands/owner.ts'],
    ...['src/cli/commands/hand-step-file.ts', 'src/cli/commands/allow-scope.ts', 'src/readonly-shell/lines.ts', 'src/automode/write.ts', 'src/skills/grants.ts'],
    ...['src/doctor/deny-lines.ts', 'src/update/run.ts', 'src/setup/install.ts', 'src/core/home.ts', 'plugins/teamrig/bin/teamrig', '.claude-plugin/marketplace.json'],
    ...['plugins/teamrig/.claude-plugin/plugin.json', 'plugins/teamrig/skills/teamrig-guide/SKILL.md', '.claude/skills/dev-ship-change/SKILL.md', '.claude/commands/x.md'],
    ...['CLAUDE.md', 'llms.txt', 'plugins/teamrig/config.schema.json', 'tools/ship/ship.ts', 'package.json'],
  ];
  /** Paths named like docs or tests that still steer an agent or a gate, which the sensitive list carves out of the low-risk one. */
  const CARVED = ['docs/CLAUDE.md', 'docs/.claude/commands/x.md', 'docs/skills/x/SKILL.md', 'tools/ship/approval.test.ts', 'src/merge/merge.test.ts', 'src/testing/fake-guard.ts'];

  it('names each of them, and clears only docs text and pictures', async () => {
    const team = await standing(await waitingKit(), 'alpha', await shippedHostGlobs({}, 'linux')());
    assert.deepEqual(sensitivePathsOf([...VERDICT, ...CARVED], team), [...VERDICT, ...CARVED]);
    const ranOnHost = ['src/cli/list.test.ts', 'src/testing/fake-steps.ts', 'web/app.spec.tsx', 'docs/build.ts', 'docs/setup.sh', 'docs/tools/run.mjs'];
    assert.deepEqual(sensitivePathsOf(ranOnHost, team), ranOnHost, 'tests and any code, in docs too, run on the host');
    const low = ['docs/commands.md', 'docs/guides/setup.md', 'docs/images/flow.svg', 'docs/pictures/pane.png', 'docs/shots/a.jpg'];
    assert.deepEqual(sensitivePathsOf(low, team), []);
    assert.deepEqual(sensitivePathsOf(['src/testing/notes.md', '.claude/commands/fix.test.md', 'README.md', 'src/brand-new/x.ts'], team), ['src/testing/notes.md', '.claude/commands/fix.test.md', 'README.md', 'src/brand-new/x.ts'], 'not code, or not listed');
  });

  it("keeps the gate's own code, secrets and agent rules sensitive inside a team's broad low-risk folder", async () => {
    const broad = { lowRisk: ['*'], sensitive: [...DEFAULT_SENSITIVE_PATHS, ...(await shippedHostGlobs({}, 'linux')())] };
    const held = ['src/config/defaults.ts', 'src/cli/ship-approval.ts', 'src/register/approval.ts', 'src/core/secrets.ts', 'tsconfig.json', 'plugins/teamrig/skills/a/SKILL.md', 'src/CLAUDE.md'];
    assert.deepEqual(sensitivePathsOf([...held, 'src/pane/view.ts'], broad), held);
  });

  it("keeps every shipped host's instruction files and folders sensitive in a team whose own lists name none of them", async () => {
    const kit = new CliHarness({ ...TEAM, pushGuard: { lowRiskPaths: ['*'], sensitivePaths: [] } });
    const team = await mergeStandingOf(kit.runtime(), 'app', 'alpha', 'T1', await shippedHostGlobs({}, 'linux')());
    const held = ['CLAUDE.md', 'CLAUDE.local.md', 'src/.claude/settings.json', 'plugins/x/.claude-plugin/plugin.json', 'GEMINI.md', '.agents/rules.md'];
    assert.deepEqual(sensitivePathsOf([...held, 'src/pane/view.ts'], team), held);
  });
});

describe('clearMerge', () => {
  const caller = { session: 'alpha', team: 'app', hostSession: CLAUDE_SESSION } as const;
  /** Reads with the tab bound to whichever session the caller names, unless `tabCallerOf` says otherwise. */
  const readsOf = (standingOf: StandingOf, tabCallerOf: TabCallerOf = async (_team, _tab, session) => session): MergeReads => ({ tabCallerOf, standingOf, changes: UNREAD });
  const fixed = (value: MergeStanding): MergeReads => readsOf(async () => value);

  it("reads the tab's session, then its standing for the team and branch task, then clears it", async () => {
    const value = await approvedBy(HEAD);
    const asked: string[][] = [];
    const reads = readsOf(
      async (team, session, taskId) => {
        asked.push(['standing', team, session, taskId]);
        return value;
      },
      async (team, tab, session) => {
        asked.push(['tab', team, tab, session]);
        return 'alpha';
      },
    );
    assert.deepEqual(await clearMerge({ ...caller, session: 'guards' }, reads, 't1-cli', HEAD, HEAD), { kind: 'approved', by: 'lead' });
    assert.deepEqual(asked, [
      ['tab', 'app', CLAUDE_SESSION, 'guards'],
      ['standing', 'app', 'alpha', 'T1'],
    ]);
  });

  it('refuses a branch that names no task, and a caller, team or tab left unset', async () => {
    const value = fixed(await approvedBy(HEAD));
    assert.equal(
      reasonOf(await clearMerge(caller, value, 'cli-fix', HEAD, HEAD)),
      'branch cli-fix names no task: a merged branch is t<id>-<name>, after any type folder (fix/t<id>-<name>)',
      'the refusal names both shapes taskOfBranch reads (GeneralA6/teamrig#1306)',
    );
    assert.match(reasonOf(await clearMerge({ ...caller, session: undefined }, value, 't1-cli', HEAD, HEAD)), /TEAMRIG_SESSION and TEAMRIG_TEAM/);
    assert.match(reasonOf(await clearMerge({ ...caller, team: '' }, value, 't1-cli', HEAD, HEAD)), /TEAMRIG_SESSION and TEAMRIG_TEAM/);
    assert.match(reasonOf(await clearMerge({ ...caller, hostSession: undefined }, value, 't1-cli', HEAD, HEAD)), /CLAUDE_CODE_SESSION_ID must name the merging Claude Code tab/);
    assert.match(reasonOf(await clearMerge({ ...caller, hostSession: '' }, value, 't1-cli', HEAD, HEAD)), /CLAUDE_CODE_SESSION_ID/);
  });

  it('clearMergeFrom reads the caller, team and tab from the env, and the marks and register through the reader', async () => {
    const kit = await waitingKit(['--note', HEAD]);
    const marks = join(TEAM_HOME, 'state', 'inbox-marks.jsonl');
    await kit.files.append(marks, `${JSON.stringify({ v: 1, area: 'alpha', line: 0, at: '2030-01-08T09:00:00.000Z', claudeSession: CLAUDE_SESSION, lastLineHash: null })}\n`);
    const env = { TEAMRIG_SESSION: ' alpha ', TEAMRIG_TEAM: 'app', CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION };
    assert.deepEqual(await clearMergeFrom(env, kit.runtime(), UNREAD, NO_HOST_GLOBS)('t1-cli', HEAD, HEAD), { kind: 'approved', by: 'lead' });
    assert.match(reasonOf(await clearMergeFrom({ ...env, TEAMRIG_SESSION: 'bravo' }, kit.runtime(), UNREAD, NO_HOST_GLOBS)('t1-cli', HEAD, HEAD)), /this Claude Code tab is not bound to bravo alone/);
    assert.match(reasonOf(await clearMergeFrom({ ...env, TEAMRIG_SESSION: 'stranger' }, kit.runtime(), UNREAD, NO_HOST_GLOBS)('t1-cli', HEAD, HEAD)), /not bound to stranger alone/);
    assert.match(reasonOf(await clearMergeFrom({ TEAMRIG_TEAM: 'app', CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION }, kit.runtime(), UNREAD, NO_HOST_GLOBS)('t1-cli', HEAD, HEAD)), /TEAMRIG_SESSION and TEAMRIG_TEAM/);
    assert.match(reasonOf(await clearMergeFrom({ TEAMRIG_SESSION: 'alpha', TEAMRIG_TEAM: 'app' }, kit.runtime(), UNREAD, NO_HOST_GLOBS)('t1-cli', HEAD, HEAD)), /CLAUDE_CODE_SESSION_ID/);
  });

  it("refuses with the tab's or the register's refusal, and lets any other failure through", async () => {
    const value = await approvedBy(HEAD);
    const refusing = readsOf(async () => {
      throw new RefusedError('stranger is no session of app');
    });
    assert.deepEqual(await clearMerge(caller, refusing, 't1-cli', HEAD, HEAD), { kind: 'refused', reason: 'stranger is no session of app' });
    const unbound = readsOf(
      async () => value,
      async () => {
        throw new RefusedError('this Claude Code tab is not bound to alpha alone');
      },
    );
    assert.deepEqual(await clearMerge(caller, unbound, 't1-cli', HEAD, HEAD), { kind: 'refused', reason: 'this Claude Code tab is not bound to alpha alone' });
    const broken = readsOf(async () => {
      throw new Error('disk gone');
    });
    await assert.rejects(clearMerge(caller, broken, 't1-cli', HEAD, HEAD), /disk gone/);
  });

  it('clearTaskMerge clears on the task the caller names, for a branch that names none, such as the release pull request (T4645)', async () => {
    const asked: string[] = [];
    const reads = readsOf(async (_team, _session, taskId) => {
      asked.push(taskId);
      return approvedBy(HEAD);
    });
    assert.deepEqual(await clearTaskMerge(caller, reads, 'T1', HEAD, HEAD), { kind: 'approved', by: 'lead' });
    assert.deepEqual(asked, ['T1']);
    assert.match(reasonOf(await clearTaskMerge({ ...caller, hostSession: '' }, reads, 'T1', HEAD, HEAD)), /CLAUDE_CODE_SESSION_ID/);
    assert.match(reasonOf(await clearTaskMerge(caller, fixed(await standing(await waitingKit())), 'T1', HEAD, HEAD)), /T1 \(waiting\) holds no approval of lead/);
  });

  it('clearTaskMergeFrom reads the caller, team and tab from the env, as clearMergeFrom does', async () => {
    const kit = await waitingKit(['--note', HEAD]);
    const marks = join(TEAM_HOME, 'state', 'inbox-marks.jsonl');
    await kit.files.append(marks, `${JSON.stringify({ v: 1, area: 'alpha', line: 0, at: '2030-01-08T09:00:00.000Z', claudeSession: CLAUDE_SESSION, lastLineHash: null })}\n`);
    const env = { TEAMRIG_SESSION: 'alpha', TEAMRIG_TEAM: 'app', CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION };
    assert.deepEqual(await clearTaskMergeFrom(env, kit.runtime(), UNREAD, NO_HOST_GLOBS)('T1', HEAD, HEAD), { kind: 'approved', by: 'lead' });
    assert.match(reasonOf(await clearTaskMergeFrom({ ...env, TEAMRIG_SESSION: 'bravo' }, kit.runtime(), UNREAD, NO_HOST_GLOBS)('T1', HEAD, HEAD)), /not bound to bravo alone/);
  });

  it("reads the paths of the head it clears for the answerer's low-risk merge (T3448)", async () => {
    const value = answering(await standing(await waitingKit()));
    const heads: string[] = [];
    const reads: MergeReads = {
      ...fixed(value),
      changes: {
        changedPaths: (head) => {
          heads.push(head);
          return ['src/a.ts'];
        },
        taskBranches: () => [],
      },
    };
    assert.deepEqual(await clearMerge(caller, reads, 't1-cli', HEAD, HEAD), { kind: 'low-risk', by: 'alpha', paths: 1 });
    assert.deepEqual(heads, [HEAD]);
  });
});

describe('changedPathsOf: the paths a head changes over main, as the review gate lists them (T3448)', () => {
  let repo: TempRepo;
  const git = (args: readonly string[]): string => repo.git(...args);
  const commitFiles = (subject: string, files: Readonly<Record<string, string>>): void => {
    for (const [path, text] of Object.entries(files)) repo.write(path, text);
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', subject);
  };

  beforeEach(() => {
    repo = new TempRepo('changed').init();
    repo.git('symbolic-ref', 'HEAD', 'refs/heads/main');
    commitFiles('base', { 'src/a.ts': 'a\n', 'src/old.ts': 'old\n', 'dist/a.js': 'a\n' });
    repo.git('checkout', '-q', '-b', 't1-change');
  });

  afterEach(() => repo.remove());

  it('lists an edit, an added file, both sides of a rename, and a name with a space, less the generated folders', () => {
    commitFiles('core: change', { 'src/a.ts': 'a2\n', 'docs/a b.md': 'doc\n', 'dist/a.js': 'a2\n', 'dist/new.js': 'n\n' });
    repo.git('mv', 'src/old.ts', 'src/renamed.ts');
    repo.git('commit', '-q', '-m', 'core: rename');
    assert.deepEqual([...changedPathsOf(git, 'HEAD', 'main', ['dist/'])].sort(), ['docs/a b.md', 'src/a.ts', 'src/old.ts', 'src/renamed.ts']);
    assert.ok(changedPathsOf(git, 'HEAD', 'main', []).includes('dist/new.js'), 'listed when not generated');
  });

  it('reads from the merge base, so what main gains after the fork never counts', () => {
    commitFiles('core: a', { 'src/a.ts': 'a2\n' });
    repo.git('checkout', '-q', 'main');
    commitFiles('main: tools', { 'tools/ship.ts': 'x\n' });
    assert.deepEqual(changedPathsOf(git, 't1-change', 'main', ['dist/']), ['src/a.ts']);
  });
});

describe('shipWritesOf: how an approval reads the paths a ship writes again (T2914 F1)', () => {
  it('leaves a folder out of the hash and masks a known version file', () => {
    assert.deepEqual(shipWritesOf(['dist/', VERSION_TS], TEAMRIG_VERSION_FILES, TEAMRIG_RELEASE_STAMPS), {
      generated: ['dist/'],
      versionFiles: TEAMRIG_VERSION_FILES.filter((file) => file.path === VERSION_TS),
      releaseStamps: TEAMRIG_RELEASE_STAMPS,
    });
  });

  it('refuses a file that is neither a folder nor a version file the ship rewrites', () => {
    assert.throws(() => shipWritesOf(['dist/', 'src/hooks.json'], TEAMRIG_VERSION_FILES, TEAMRIG_RELEASE_STAMPS), /regenerated path src\/hooks\.json is no folder the build rebuilds and no version file/);
  });

  it("masks the shipped repos.json's release manifest, which a catch-up sets again, and needs it known to (T4298)", () => {
    const { regenerated } = profileFor(readProfiles(), 'GeneralA6/teamrig');
    assert.deepEqual(
      shipWritesOf(regenerated, TEAMRIG_SHIP_VERSION_FILES, TEAMRIG_RELEASE_STAMPS).versionFiles.map((file) => file.path),
      [...TEAMRIG_VERSION_FILES, TEAMRIG_RELEASE_MANIFEST].map((file) => file.path),
    );
    assert.throws(() => shipWritesOf(regenerated, TEAMRIG_VERSION_FILES, TEAMRIG_RELEASE_STAMPS), /regenerated path \.release-please-manifest\.json is no folder/);
  });

  it("teamrigShipWritesOf, which the ship and the merge both read work by, knows the shipped repos.json's every path (T4298)", () => {
    const { regenerated } = profileFor(readProfiles(), 'GeneralA6/teamrig');
    assert.deepEqual(teamrigShipWritesOf(regenerated), shipWritesOf(regenerated, TEAMRIG_SHIP_VERSION_FILES, TEAMRIG_RELEASE_STAMPS));
  });

  it("teamrigShipWritesOf knows another repo's plugin manifest by its shape, and still refuses any other file (T4821)", () => {
    const pane = 'plugins/teamrig-pane/.claude-plugin/plugin.json';
    const { versionFiles } = teamrigShipWritesOf([pane, TEAMRIG_RELEASE_MANIFEST.path]);
    assert.deepEqual(versionFiles.map((file) => file.path), [pane, TEAMRIG_RELEASE_MANIFEST.path]);
    assert.equal(versionFiles[0]?.pattern.exec(manifest('0.77.0'))?.[2], '0.77.0');
    assert.throws(() => teamrigShipWritesOf(['plugins/teamrig-pane/hooks/hooks.json']), /regenerated path plugins\/teamrig-pane\/hooks\/hooks\.json is no folder/);
    assert.throws(() => teamrigShipWritesOf(['plugins/teamrig-pane/nested/.claude-plugin/plugin.json']), /is no folder the build rebuilds/);
  });

  it("keeps only the release stamps whose version file the profile names, so a repo with no src/core/version.ts has none (T5320)", () => {
    const { regenerated } = profileFor(readProfiles(), 'GeneralA6/teamrig');
    assert.deepEqual(teamrigShipWritesOf(regenerated).releaseStamps, TEAMRIG_RELEASE_STAMPS);
    assert.deepEqual(teamrigShipWritesOf(['dist/', 'plugins/teamrig-pane/.claude-plugin/plugin.json', TEAMRIG_RELEASE_MANIFEST.path]).releaseStamps, []);
  });
});

describe('changePatch on a repo with no src/core/version.ts, as teamrig-pane is (T5320)', () => {
  const PANE_MANIFEST = 'plugins/teamrig-pane/.claude-plugin/plugin.json';
  const README = 'README.md';
  let repo: TempRepo;

  before(() => {
    repo = new TempRepo('approval-pane').init();
    repo.git('symbolic-ref', 'HEAD', 'refs/heads/main');
    repo.write(PANE_MANIFEST, manifest('0.83.1'));
    repo.write(README, '# Pane\n\nRuns on Node 22.\n');
    repo.git('add', '--', PANE_MANIFEST, README);
    repo.git('commit', '-q', '-m', 'base');
    repo.git('checkout', '-q', '-b', 't4033-node-24');
    repo.write(README, '# Pane\n\nRuns on Node 24 (since 0.84.0).\n');
    repo.git('commit', '-q', '-am', 'build: node 24');
  });

  after(() => repo.remove());

  it('fingerprints a head whose diff changes a Markdown file, which read teamrig\'s version file and threw before', () => {
    const writes = teamrigShipWritesOf(['dist/', PANE_MANIFEST, TEAMRIG_RELEASE_MANIFEST.path]);
    const git = (args: readonly string[]): string => repo.git(...args);
    const approved = changePatch(git, 'HEAD', 'main', writes);
    assert.match(approved, /^[0-9a-f]{64}$/);
    repo.write(README, '# Pane\n\nRuns on Node 24 (since 0.85.0).\n');
    repo.git('commit', '-q', '-am', 'docs: another stamp');
    assert.notEqual(changePatch(git, 'HEAD', 'main', writes), approved, 'with no stamp of its own, a since line is work');
  });
});

describe('changePatch: the fingerprint of what a branch changes over main', () => {
  const WRITES = shipWritesOf(['dist/', MANIFEST, VERSION_TS], TEAMRIG_VERSION_FILES, TEAMRIG_RELEASE_STAMPS);
  let repo: TempRepo;
  const git = (args: readonly string[]): string => repo.git(...args);
  const commitFiles = (subject: string, files: Readonly<Record<string, string>>): string => {
    for (const [path, text] of Object.entries(files)) repo.write(path, text);
    repo.git('add', '--', ...Object.keys(files));
    repo.git('commit', '-q', '-m', subject);
    return repo.git('rev-parse', 'HEAD').trim();
  };
  const raise = (version: string): string => commitFiles(`plugin: version ${version}`, { [MANIFEST]: manifest(version), [VERSION_TS]: versionTs(version) });
  const patch = (rev = 'HEAD'): string => changePatch(git, rev, 'main', WRITES);
  const lines = (from: number, to: number): string => Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}\n`).join('');

  // main's base commit and t1-change's one commit on it, built once with git and copied per test (T5032): each test
  // then starts at t1-change with no git run of its own setup.
  let template: TempRepo;

  before(() => {
    repo = new TempRepo('approval-template').init();
    repo.git('symbolic-ref', 'HEAD', 'refs/heads/main');
    commitFiles('base', { 'src/a.ts': lines(1, 20), 'src/b.ts': 'b\n', 'dist/a.js': 'a\n', [MANIFEST]: manifest('0.1.0'), [VERSION_TS]: versionTs('0.1.0'), [MIGRATE_TS]: migration(1, '0.1.0'), [GUIDE]: GUIDE_BASE, [SCHEMA]: '{}\n' });
    repo.git('checkout', '-q', '-b', 't1-change');
    commitFiles('core: a', { 'src/a.ts': lines(1, 20).replace('line 15\n', 'line fifteen\n'), 'src/new.ts': 'new\n' });
    template = repo;
  });

  beforeEach(() => {
    repo = new TempRepo('approval').copyFrom(template);
  });

  afterEach(() => repo.remove());

  after(() => template.remove());

  it('is a sha256, the same on the same change', () => {
    assert.match(patch(), /^[0-9a-f]{64}$/);
    assert.equal(patch(), patch());
  });

  it('keeps the fingerprint when the branch is rebased over main lines above its own, its version raised and its dist rebuilt', () => {
    const approved = patch();
    repo.git('checkout', '-q', 'main');
    commitFiles('main: more', { 'src/a.ts': `line 0\n${lines(1, 20)}`, 'src/b.ts': 'b2\n', 'dist/a.js': 'a2\n' });
    raise('0.2.0');
    repo.git('checkout', '-q', 't1-change');
    repo.git('rebase', '-q', 'main');
    raise('0.3.0');
    commitFiles('build: dist', { 'dist/a.js': 'a3\n', 'dist/new.js': 'new\n' });
    assert.equal(patch(), approved);
  });

  it('keeps the fingerprint when the raise is the last file of the diff, approved without it and merged with it (T4216)', () => {
    repo.git('checkout', '-q', '-b', 't2-lock', 'main');
    commitFiles('core: lock', { 'src/core/lock.ts': 'lock\n' });
    const approved = patch();
    raise('0.2.0');
    assert.equal(patch(), approved);
  });

  it('keeps the fingerprint when a catch-up sets the release manifest again on a newer version, and moves it on any other edit there (T4298)', () => {
    const RELEASE = TEAMRIG_RELEASE_MANIFEST.path;
    const writes = shipWritesOf(['dist/', MANIFEST, VERSION_TS, RELEASE], TEAMRIG_SHIP_VERSION_FILES, TEAMRIG_RELEASE_STAMPS);
    const release = (version: string, more = ''): string => `{\n  ".": "${version}"${more}\n}\n`;
    const fingerprint = (): string => changePatch(git, 'HEAD', 'main', writes);
    repo.git('checkout', '-q', 'main');
    commitFiles('release: the manifest', { [RELEASE]: release('0.0.9') });
    repo.git('checkout', '-q', 't1-change');
    repo.git('rebase', '-q', 'main');
    commitFiles("fix(release): the manifest starts from main's version, 0.1.0", { [RELEASE]: release('0.1.0') });
    const approved = fingerprint();
    repo.git('reset', '-q', '--hard', 'HEAD~1');
    commitFiles("fix(release): the manifest starts from main's version, 0.2.0", { [RELEASE]: release('0.2.0') });
    assert.equal(fingerprint(), approved);
    repo.git('reset', '-q', '--hard', 'HEAD~1');
    commitFiles("fix(release): the manifest starts from main's version, 0.1.0", { [RELEASE]: release('0.1.0', ',\n  "extra": "1.0.0"') });
    assert.notEqual(fingerprint(), approved, 'a key beside the version is work');
  });

  it('moves the fingerprint on any change to the branch outside its generated folders', () => {
    const approved = patch();
    const sneaked = commitFiles('core: more', { 'src/b.ts': 'b, changed\n' });
    assert.notEqual(patch(sneaked), approved, 'a new file change');
    repo.git('checkout', '-q', '-b', 't1-edited', 'HEAD~1');
    commitFiles('core: a, edited', { 'src/new.ts': 'new, edited\n' });
    assert.notEqual(patch(), approved, 'an edit of a line the approved change made');
  });

  it('moves the fingerprint on an edit to a version file beyond its version, a raise with it too (T2914 F1)', () => {
    raise('0.2.0');
    const approved = patch();
    commitFiles('core: version line', { [VERSION_TS]: `${versionTs('0.2.0')}import './later.ts';\n` });
    assert.notEqual(patch(), approved, 'a line added to version.ts');
    repo.git('checkout', '-q', '-b', 't1-hooks', 'HEAD~1');
    commitFiles('plugin: version 0.3.0', { [MANIFEST]: manifest('0.3.0', HOOKS_KEY), [VERSION_TS]: versionTs('0.3.0') });
    assert.notEqual(patch(), approved, 'a hooks key added to plugin.json in the version raise');
  });

  it('hashes a path git reads as binary by its content (T2914 F2)', () => {
    repo.git('checkout', '-q', 'main');
    commitFiles('main: attributes', { '.gitattributes': 'notes.txt -diff\n' });
    repo.git('checkout', '-q', 't1-change');
    repo.git('rebase', '-q', 'main');
    const base = repo.git('rev-parse', 'HEAD').trim();
    commitFiles('docs: notes', { 'notes.txt': 'one\n', 'src/blob.bin': 'a\u0000b\n' });
    const approved = patch();
    repo.git('checkout', '-q', '-b', 't1-notes', base);
    commitFiles('docs: notes', { 'notes.txt': 'two\n', 'src/blob.bin': 'a\u0000b\n' });
    assert.notEqual(patch(), approved, 'a path .gitattributes marks -diff');
    repo.git('checkout', '-q', '-b', 't1-blob', base);
    commitFiles('docs: notes', { 'notes.txt': 'one\n', 'src/blob.bin': 'a\u0000c\n' });
    assert.notEqual(patch(), approved, 'a binary file');
  });

  /**
   * A change that adds config migration 2, stamped with the version it ships in, approved at its raise to 0.2.0; then
   * main takes 0.2.0, and the same change is made again on it, its raise and stamp set to 0.3.0 (T3419).
   */
  function stampedAgain(): string {
    commitFiles('config: migration 2', { [MIGRATE_TS]: `${migration(1, '0.1.0')}${migration(2, '0.2.0')}` });
    raise('0.2.0');
    const approved = repo.git('rev-parse', 'HEAD').trim();
    repo.git('checkout', '-q', 'main');
    raise('0.2.0');
    repo.git('checkout', '-q', '-b', 't1-again');
    commitFiles('core: a', { 'src/a.ts': lines(1, 20).replace('line 15\n', 'line fifteen\n'), 'src/new.ts': 'new\n' });
    commitFiles('config: migration 2', { [MIGRATE_TS]: `${migration(1, '0.1.0')}${migration(2, '0.3.0')}` });
    raise('0.3.0');
    return approved;
  }

  it("keeps the fingerprint and each patch id when a migration's release stamp is set again with the raise on a newer main (T3419)", () => {
    const approved = stampedAgain();
    assert.equal(patch(), patch(approved));
    assert.deepEqual(workChanges(workCommitsOf(git, approved, 'main', WRITES), workCommitsOf(git, 'HEAD', 'main', WRITES)), []);
  });

  it("moves the fingerprint on an edit to an existing migration's stamp, or to a line of the added migration beside its stamp (T3419)", () => {
    const approved = stampedAgain();
    const restamped = commitFiles('config: restamp 1', { [MIGRATE_TS]: `${migration(1, '0.3.0')}${migration(2, '0.3.0')}` });
    assert.notEqual(patch(restamped), patch(approved), 'an existing stamp');
    repo.git('checkout', '-q', '-b', 't1-from', 'HEAD~1');
    commitFiles('config: migration 2 from 3', { [MIGRATE_TS]: `${migration(1, '0.1.0')}${migration(2, '0.3.0').replace('from: 2', 'from: 3')}` });
    assert.notEqual(patch(), patch(approved), 'a line beside the stamp');
  });

  /**
   * A change that adds a docs line naming the version it ships in, approved at its raise to 0.2.0; then main takes
   * 0.2.0, and the same change is made again on it, its raise and the line's version set to 0.3.0 (#1411).
   */
  function sinceAgain(): string {
    const docs = (version: string): Record<string, string> => ({
      [GUIDE]: `${GUIDE_BASE}- \`open.idle.x\` (since ${version}) reopens it.\n`,
      [SCHEMA]: `{ "x": { "description": "Reopens it (since ${version})." } }\n`,
    });
    commitFiles('docs: x', docs('0.2.0'));
    raise('0.2.0');
    const approved = repo.git('rev-parse', 'HEAD').trim();
    repo.git('checkout', '-q', 'main');
    raise('0.2.0');
    repo.git('checkout', '-q', '-b', 't1-again');
    commitFiles('core: a', { 'src/a.ts': lines(1, 20).replace('line 15\n', 'line fifteen\n'), 'src/new.ts': 'new\n' });
    commitFiles('docs: x', docs('0.3.0'));
    raise('0.3.0');
    return approved;
  }

  it("keeps the fingerprint and each patch id when an added docs line's since is set again with the raise on a newer main (#1411)", () => {
    const approved = sinceAgain();
    assert.equal(patch(), patch(approved));
    assert.deepEqual(workChanges(workCommitsOf(git, approved, 'main', WRITES), workCommitsOf(git, 'HEAD', 'main', WRITES)), []);
  });

  it("moves the fingerprint on an existing docs line's since, a since of another version, or other words on the added line (#1411)", () => {
    const approved = sinceAgain();
    const old = commitFiles('docs: restamp the old line', { [GUIDE]: `${GUIDE_BASE.replace('0.1.0', '0.3.0')}- \`open.idle.x\` (since 0.3.0) reopens it.\n` });
    assert.notEqual(patch(old), patch(approved), 'a line the change does not add');
    repo.git('checkout', '-q', '-b', 't1-other', 'HEAD~1');
    commitFiles('docs: x older', { [GUIDE]: `${GUIDE_BASE}- \`open.idle.x\` (since 0.1.5) reopens it.\n` });
    assert.notEqual(patch(), patch(approved), 'a version the change does not ship in');
    repo.git('checkout', '-q', '-b', 't1-words', 't1-again');
    commitFiles('docs: x closes', { [GUIDE]: `${GUIDE_BASE}- \`open.idle.x\` (since 0.3.0) closes it.\n` });
    assert.notEqual(patch(), patch(approved), 'other words on the line');
  });

  it('keeps the fingerprint of a head whose raise is not committed yet, its stamp the next release, made again on a newer main (T3419)', () => {
    commitFiles('config: migration 2', { [MIGRATE_TS]: `${migration(1, '0.1.0')}${migration(2, '0.2.0')}` });
    const approved = repo.git('rev-parse', 'HEAD').trim();
    repo.git('checkout', '-q', 'main');
    raise('0.2.0');
    repo.git('checkout', '-q', '-b', 't1-again');
    commitFiles('core: a', { 'src/a.ts': lines(1, 20).replace('line 15\n', 'line fifteen\n'), 'src/new.ts': 'new\n' });
    commitFiles('config: migration 2', { [MIGRATE_TS]: `${migration(1, '0.1.0')}${migration(2, '0.3.0')}` });
    raise('0.3.0');
    assert.equal(patch(), patch(approved));
    assert.deepEqual(workChanges(workCommitsOf(git, approved, 'main', WRITES), workCommitsOf(git, 'HEAD', 'main', WRITES)), []);
  });

  it('moves the fingerprint and the patch id on an added stamp of a version the change does not ship in (T3419)', () => {
    const approved = stampedAgain();
    repo.git('checkout', '-q', '-b', 't1-high', 'HEAD~2');
    commitFiles('config: migration 2', { [MIGRATE_TS]: `${migration(1, '0.1.0')}${migration(2, '0.9.0')}` });
    raise('0.3.0');
    assert.notEqual(patch(), patch(approved), 'a stamp above the raise');
    assert.notDeepEqual(workChanges(workCommitsOf(git, approved, 'main', WRITES), workCommitsOf(git, 'HEAD', 'main', WRITES)), []);
    repo.git('checkout', '-q', '-b', 't1-unraised', 'HEAD~2');
    const next = commitFiles('config: migration 2', { [MIGRATE_TS]: `${migration(1, '0.1.0')}${migration(2, '0.3.0')}` });
    repo.git('checkout', '-q', '-b', 't1-far', 'HEAD~1');
    const far = commitFiles('config: migration 2', { [MIGRATE_TS]: `${migration(1, '0.1.0')}${migration(2, '0.5.0')}` });
    assert.notEqual(patch(far), patch(next), 'a head with no raise committed, stamped past the next release');
  });

  it('gives an existing stamp edited to two different versions two fingerprints (T3419)', () => {
    stampedAgain();
    const head = repo.git('rev-parse', 'HEAD').trim();
    const shipped = commitFiles('config: restamp 1', { [MIGRATE_TS]: `${migration(1, '0.3.0')}${migration(2, '0.3.0')}` });
    repo.git('checkout', '-q', '-b', 't1-other', head);
    const other = commitFiles('config: restamp 1', { [MIGRATE_TS]: `${migration(1, '0.4.0')}${migration(2, '0.3.0')}` });
    assert.notEqual(patch(other), patch(shipped));
  });

  it('reads the change from the merge base, so commits main gains after the fork never count', () => {
    const approved = patch();
    repo.git('checkout', '-q', 'main');
    commitFiles('main: other', { 'src/c.ts': 'c\n' });
    repo.git('checkout', '-q', 't1-change');
    assert.equal(patch(), approved);
  });

  describe('workCommitsOf: the commits a branch carries, with their patch ids (T2913)', () => {
    const work = (rev = 'HEAD'): WorkCommit[] => workCommitsOf(git, rev, 'main', WRITES);

    it('lists the work commits oldest first, and leaves out a version raise and a dist rebuild', () => {
      commitFiles('docs: b', { 'src/b.ts': 'b, documented\n' });
      raise('0.2.0');
      commitFiles('build: dist', { 'dist/a.js': 'a2\n' });
      assert.deepEqual(work().map(({ subject, merge }) => ({ subject, merge })), [{ subject: 'core: a', merge: false }, { subject: 'docs: b', merge: false }]);
      assert.match(work()[0]?.patch ?? '', /^[0-9a-f]{64}$/);
    });

    it('keeps every patch id over a rebase onto main lines away from its own, so the two heads compare equal', () => {
      commitFiles('docs: b', { 'src/b.ts': 'b, documented\n' });
      raise('0.2.0');
      const approved = repo.git('rev-parse', 'HEAD').trim();
      repo.git('checkout', '-q', 'main');
      commitFiles('main: more', { 'src/a.ts': `line 0\n${lines(1, 20)}`, 'dist/a.js': 'a2\n' });
      raise('0.2.0');
      repo.git('checkout', '-q', 't1-change');
      repo.git('rebase', '-q', 'main');
      raise('0.3.0');
      assert.notEqual(repo.git('rev-parse', 'HEAD').trim(), approved);
      assert.deepEqual(workChanges(work(approved), work()), []);
    });

    it('counts a commit that adds a line to version.ts or a hooks key to plugin.json as work, so it refuses (T2914 F1)', () => {
      raise('0.2.0');
      const approved = repo.git('rev-parse', 'HEAD').trim();
      const line = commitFiles('plugin: version 0.2.0', { [VERSION_TS]: `${versionTs('0.2.0')}import './later.ts';\n` });
      assert.deepEqual(workChanges(work(approved), work()), [`added ${line.slice(0, 9)} "plugin: version 0.2.0"`]);
      repo.git('checkout', '-q', '-b', 't1-hooks', approved);
      const hooks = commitFiles('plugin: version 0.3.0', { [MANIFEST]: manifest('0.3.0', HOOKS_KEY), [VERSION_TS]: versionTs('0.3.0') });
      assert.deepEqual(workChanges(work(approved), work()), [`added ${hooks.slice(0, 9)} "plugin: version 0.3.0"`]);
    });

    it('tells apart two contents of a path git reads as binary (T2914 F2)', () => {
      const base = repo.git('rev-parse', 'HEAD').trim();
      commitFiles('docs: notes', { '.gitattributes': 'notes.txt -diff\n', 'notes.txt': 'one\n' });
      const approved = repo.git('rev-parse', 'HEAD').trim();
      repo.git('checkout', '-q', '-b', 't1-notes', base);
      const swapped = commitFiles('docs: notes', { '.gitattributes': 'notes.txt -diff\n', 'notes.txt': 'two\n' });
      assert.deepEqual(workChanges(work(approved), work()), [`changed ${approved.slice(0, 9)} "docs: notes", now ${swapped.slice(0, 9)}`]);
    });

    it('moves the patch id of a commit whose own lines or context changed', () => {
      const approved = repo.git('rev-parse', 'HEAD').trim();
      repo.git('checkout', '-q', 'main');
      commitFiles('main: near', { 'src/a.ts': lines(1, 20).replace('line 12\n', 'line twelve\n') });
      repo.git('checkout', '-q', 't1-change');
      repo.git('rebase', '-q', 'main');
      assert.deepEqual(workChanges(work(approved), work()), [`changed ${approved.slice(0, 9)} "core: a", now ${repo.git('rev-parse', 'HEAD').trim().slice(0, 9)}`]);
    });

    it('lists a merge commit as one, with no patch', () => {
      repo.git('checkout', '-q', '-b', 'side', 'main');
      commitFiles('side: c', { 'src/c.ts': 'c\n' });
      repo.git('checkout', '-q', 't1-change');
      repo.git('merge', '-q', '--no-ff', '-m', 'merge side', 'side');
      const listed = work().map(({ subject, merge, patch: id }) => ({ subject, merge, empty: id === '' }));
      assert.deepEqual(listed.toSorted((a, b) => a.subject.localeCompare(b.subject)), [
        { subject: 'core: a', merge: false, empty: false },
        { subject: 'merge side', merge: true, empty: true },
        { subject: 'side: c', merge: false, empty: false },
      ]);
    });
  });
});
