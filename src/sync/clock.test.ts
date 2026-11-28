import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { testHostIssue } from '../testing/host-issue.ts';
import { TimeZone } from '../core/zone.ts';
import { DEFAULT_REPLIES } from '../config/defaults.ts';
import { formatClocks, isLate, issueThread, lateGroupText, lateText, parseClocks, remindersText, reminderText, REMIND_SHARE, stepClocks, waitingSince, type Clock, type MarkPost, type Thread, type ThreadPost } from './clock.ts';

const HOUR = 3_600_000;
/** A team that set no `replies.targetHours`: the design table. */
const TARGETS = DEFAULT_REPLIES.targetHours;
/** A tracker's marks as a test states them: a bot's none, a member's ours, any other's theirs. */
const BY_TIE: MarkPost = (post) => (post.authorKind === 'Bot' ? 'none' : post.authorAssociation === 'MEMBER' ? 'ours' : 'theirs');
const T0 = Date.UTC(2026, 10, 15, 8);
const outside = (hours: number): ThreadPost => ({ at: T0 + hours * HOUR, ours: false, login: `ada${hours}` });
const ours = (hours: number): ThreadPost => ({ at: T0 + hours * HOUR, ours: true, login: 'octocat' });
const thread = (number: number, posts: readonly ThreadPost[], kind: Thread['kind'] = 'bug'): Thread => ({ tracker: 'github', repo: 'acme/app', ref: `acme/app#${number}`, kind, owner: 'alpha', title: 'Crash', posts });
/** A clock of acme/app#1 as stepClocks starts it from `thread`. */
const stepped = (since: number, author: string, remindedAt: number | undefined = undefined): Clock => ({ tracker: 'github', repo: 'acme/app', ref: 'acme/app#1', kind: 'bug', owner: 'alpha', title: 'Crash', author, assignedTo: '', since, remindedAt });

describe('waitingSince', () => {
  it('starts at the oldest outside post after our newest one, so a follow-up does not restart the wait', () => {
    assert.equal(waitingSince([outside(0), ours(1), outside(2), outside(5)]), T0 + 2 * HOUR);
  });

  it('is undefined when we spoke last, or only we posted', () => {
    assert.equal(waitingSince([outside(0), ours(1)]), undefined);
    assert.equal(waitingSince([ours(0)]), undefined);
    assert.equal(waitingSince([]), undefined);
  });

  it('reads posts in time order whatever order they come in', () => {
    assert.equal(waitingSince([outside(5), ours(1), outside(0), outside(2)]), T0 + 2 * HOUR);
  });
});

describe('the answer targets', () => {
  it('pins the design table: security 4 h, bug, pull and comment 24 h, feature 72 h; reminded at 75%', () => {
    assert.deepEqual(TARGETS, { security: 4, bug: 24, pull: 24, comment: 24, feature: 72 });
    assert.equal(REMIND_SHARE, 0.75);
  });

  it("times each clock by the team's own target, in the reminder text too (T5796)", () => {
    const team = { ...TARGETS, bug: 8 };
    const clock: Clock = { tracker: 'github', repo: 'acme/web', ref: 'gh:acme/web#9', kind: 'bug', owner: 'alpha', title: '', author: '', assignedTo: '', since: T0, remindedAt: undefined };
    assert.equal(isLate(clock, T0 + 8 * HOUR, team), true);
    assert.equal(isLate(clock, T0 + 8 * HOUR, TARGETS), false);
    assert.deepEqual(stepClocks(new Map(), new Set(['acme/app']), [thread(1, [outside(0)])], T0 + 6 * HOUR, team).remind.map((one) => one.ref), ['acme/app#1']);
    assert.match(reminderText(clock, T0 + 6 * HOUR, TimeZone.UTC, team), /by 11-15 16:00 UTC, its 8 h target/);
  });

  it('is late at its target, not before', () => {
    assert.equal(isLate({ kind: 'security', since: T0 }, T0 + 4 * HOUR - 1, TARGETS), false);
    assert.equal(isLate({ kind: 'security', since: T0 }, T0 + 4 * HOUR, TARGETS), true);
  });
});

describe('stepClocks', () => {
  const read = new Set(['acme/app']);

  it('starts a clock on a thread waiting on us, and none on one we answered', () => {
    const step = stepClocks(new Map(), read, [thread(1, [outside(0)]), thread(2, [outside(0), ours(1)])], T0 + HOUR, TARGETS);
    assert.deepEqual([...step.clocks.keys()], ['acme/app#1']);
    assert.deepEqual(step.clocks.get('acme/app#1'), stepped(T0, 'ada0'));
    assert.deepEqual(step.remind, []);
  });

  it('reminds once at 75% of the target, and keeps the reminder while the same wait runs', () => {
    const at = T0 + 18 * HOUR;
    const first = stepClocks(new Map(), read, [thread(1, [outside(0)])], at, TARGETS);
    assert.deepEqual(first.remind.map((clock) => clock.ref), ['acme/app#1']);
    assert.equal(first.clocks.get('acme/app#1')?.remindedAt, at);
    const second = stepClocks(first.clocks, read, [thread(1, [outside(0), outside(19)])], at + HOUR, TARGETS);
    assert.deepEqual(second.remind, []);
    assert.equal(second.clocks.get('acme/app#1')?.remindedAt, at);
  });

  it('does not remind before 75%', () => {
    assert.deepEqual(stepClocks(new Map(), read, [thread(1, [outside(0)])], T0 + 18 * HOUR - 1, TARGETS).remind, []);
  });

  it('starts afresh, reminder cleared, once we answered and the outsider posts again', () => {
    const before: ReadonlyMap<string, Clock> = new Map([['acme/app#1', { ...stepped(T0, 'ada0', T0 + 18 * HOUR), assignedTo: 'octocat' }]]);
    const step = stepClocks(before, read, [thread(1, [outside(0), ours(20), outside(21)])], T0 + 22 * HOUR, TARGETS);
    assert.deepEqual(step.clocks.get('acme/app#1'), { ...stepped(T0 + 21 * HOUR, 'ada21'), assignedTo: 'octocat' }, 'the assignee is kept, the author is the new wait\'s');
  });

  it('stops the clock of a thread answered, closed or gone from a repository read, and keeps those of one not read', () => {
    const clock = (ref: string): Clock => ({ ...stepped(T0, 'ada0'), repo: ref.slice(0, ref.indexOf('#')), ref });
    const before = new Map([['acme/app#1', clock('acme/app#1')], ['acme/app#2', clock('acme/app#2')], ['acme/docs#3', clock('acme/docs#3')]]);
    const step = stepClocks(before, read, [thread(1, [outside(0), ours(1)])], T0 + 2 * HOUR, TARGETS);
    assert.deepEqual([...step.clocks.keys()], ['acme/docs#3']);
  });
});

describe('issueThread', () => {
  const at = (hours: number): string => new Date(T0 + hours * HOUR).toISOString();

  it('reads the opening post and the comments, ours by tie, a bot left out', () => {
    const issue = testHostIssue(4, {
      authorAssociation: 'NONE',
      createdAt: at(0),
      comments: [
        { at: at(1), login: 'maintainer', authorAssociation: 'MEMBER', authorKind: 'User' },
        { at: at(2), login: 'ci-bot', authorAssociation: 'NONE', authorKind: 'Bot' },
        { at: at(3), login: 'ada', authorAssociation: 'CONTRIBUTOR', authorKind: 'User' },
      ],
    });
    assert.deepEqual(issueThread('github', issue, 'gh:acme/web#4', 'alpha', false, BY_TIE), {
      tracker: 'github',
      repo: 'acme/web',
      ref: 'gh:acme/web#4',
      kind: 'feature',
      owner: 'alpha',
      title: issue.title,
      posts: [
        { at: T0, ours: false, login: issue.author },
        { at: T0 + HOUR, ours: true, login: 'maintainer' },
        { at: T0 + 3 * HOUR, ours: false, login: 'ada' },
      ],
    });
  });

  it('names the kind by label, security before bug, else comment on a held thread, else feature', () => {
    const kind = (labels: readonly string[], held: boolean): string | undefined => issueThread('github', testHostIssue(1, { labels }), 'r', 'alpha', held, BY_TIE)?.kind;
    assert.equal(kind(['Bug', 'Security'], false), 'security');
    assert.equal(kind(['BUG'], true), 'bug');
    assert.equal(kind([], true), 'comment');
    assert.equal(kind(['enhancement'], false), 'feature');
  });

  it('gives no thread for a closed issue', () => {
    assert.equal(issueThread('github', testHostIssue(1, { state: 'closed' }), 'r', 'alpha', false, BY_TIE), undefined);
  });

  it("takes each post's mark from the tracker alone, whatever its tie, opening post first (T5796)", () => {
    const issue = testHostIssue(4, {
      authorAssociation: 'OWNER',
      author: 'acme',
      createdAt: at(0),
      comments: [{ at: at(1), login: 'jira-user', authorAssociation: '', authorKind: '' }],
    });
    const asked: string[] = [];
    const byLogin: MarkPost = (post) => {
      asked.push(post.login);
      return post.login === 'jira-user' ? 'ours' : 'theirs';
    };
    assert.deepEqual(
      issueThread('jira', issue, 'r', 'alpha', false, byLogin)?.posts.map((post) => post.ours),
      [false, true],
    );
    assert.deepEqual(asked, ['acme', 'jira-user']);
  });
});

describe('the clocks file', () => {
  it("reads a format 1 file, GitHub's clocks file, as GitHub's rows with every clock kept (T5796)", () => {
    const rows = parseClocks('{"v":1,"clocks":[{"repo":"a","ref":"a#1","kind":"bug","owner":"x","since":1,"remindedAt":2}]}');
    assert.deepEqual([...rows.values()], [{ tracker: 'github', repo: 'a', ref: 'a#1', kind: 'bug', owner: 'x', title: '', author: '', assignedTo: '', since: 1, remindedAt: 2 }]);
  });

  it('reads back what it wrote, a reminder time too, and reads a damaged file or entry as none', () => {
    const clocks = new Map<string, Clock>([
      ['a#1', { tracker: 'github', repo: 'a', ref: 'a#1', kind: 'security', owner: 'alpha', title: '', author: 'ada', assignedTo: '', since: T0, remindedAt: T0 + HOUR }],
      ['a#2', { ...{ tracker: 'github', repo: 'a', ref: 'a#2', kind: 'feature', owner: 'bravo', title: '', author: '', assignedTo: '', since: T0, remindedAt: undefined }, tracker: 'jira', title: 'Ask', assignedTo: 'octocat' }],
    ]);
    assert.deepEqual(parseClocks(formatClocks(clocks)), clocks);
    assert.equal(parseClocks('not json').size, 0);
    assert.equal(parseClocks('{"v":3,"clocks":[]}').size, 0);
    assert.deepEqual([...parseClocks('{"v":2,"clocks":[{"repo":"a","ref":"a#1","kind":"bug","owner":"x","since":1}]}').keys()], [], 'a format 2 row naming no tracker is damaged');
    assert.deepEqual([...parseClocks('{"v":1,"clocks":[{"repo":"a","ref":"a#1","kind":"urgent","owner":"x","since":1},{"repo":"a","ref":"a#2","kind":"bug","owner":"x","since":1}]}').keys()], ['a#2']);
  });
});

describe('the texts', () => {
  const zone = TimeZone.UTC;
  const clock: Clock = { tracker: 'github', repo: 'acme/web', ref: 'gh:acme/web#9', kind: 'bug', owner: 'alpha', title: '', author: '', assignedTo: '', since: T0, remindedAt: undefined };

  it("words the owner's reminder and the lead's GH-LATE line, times zone-marked", () => {
    assert.equal(
      reminderText(clock, T0 + 18 * HOUR, zone, TARGETS),
      'GitHub gh:acme/web#9 (bug) has waited 18 h for an answer of ours, since 11-15 08:00 UTC; answer it in words on GitHub by 11-16 08:00 UTC, its 24 h target, or GH-LATE goes to the lead',
    );
    assert.equal(
      lateText(clock, T0 + 25 * HOUR, zone, TARGETS),
      'GH-LATE gh:acme/web#9 (bug, alpha) has waited 25 h for an answer of ours since 11-15 08:00 UTC, past its 24 h target: have alpha answer it on GitHub',
    );
  });

  it('words one thread as its own line, and several as one line with the count and the first few refs (#1475)', () => {
    const at = (n: number, since: number, kind: Clock['kind'] = 'bug', owner = 'alpha'): Clock => ({ ...clock, ref: `gh:acme/web#${n}`, since, kind, owner });
    assert.equal(remindersText([clock], T0 + 18 * HOUR, zone, TARGETS), reminderText(clock, T0 + 18 * HOUR, zone, TARGETS));
    assert.equal(lateGroupText([clock], T0 + 25 * HOUR, zone, TARGETS), lateText(clock, T0 + 25 * HOUR, zone, TARGETS));
    // Due first leads the reminder: the security thread's 4 h target falls before the older bug's 24 h one.
    const due = [at(1, T0), at(2, T0 + HOUR), at(3, T0 + 15 * HOUR, 'security'), at(4, T0 + 2 * HOUR), at(5, T0 + 3 * HOUR, 'feature')];
    assert.equal(
      remindersText(due, T0 + 18 * HOUR, zone, TARGETS),
      '5 GitHub threads wait for an answer of ours: gh:acme/web#3 (security, by 11-16 03:00 UTC), gh:acme/web#1 (bug, by 11-16 08:00 UTC), gh:acme/web#2 (bug, by 11-16 09:00 UTC) and 2 more; answer each in words on GitHub by its target, or GH-LATE goes to the lead',
    );
    const late = [at(7, T0 + HOUR, 'bug', 'bravo'), at(6, T0), at(8, T0 + 2 * HOUR)];
    assert.equal(
      lateGroupText(late, T0 + 30 * HOUR, zone, TARGETS),
      'GH-LATE 3 GitHub threads waited past their answer target for an answer of ours, oldest first: gh:acme/web#6 (bug, alpha, 30 h), gh:acme/web#7 (bug, bravo, 29 h), gh:acme/web#8 (bug, alpha, 28 h): have their owners answer them on GitHub',
    );
  });
});
