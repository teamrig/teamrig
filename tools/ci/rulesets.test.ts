import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isRecord, recordField, stringField, type JsonRecord } from '../lib/guards.ts';

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

function readRecord(path: string): JsonRecord {
  const parsed: unknown = JSON.parse(read(path));
  assert.ok(isRecord(parsed), `${path} is a JSON object`);
  return parsed;
}

function records(value: unknown, what: string): readonly JsonRecord[] {
  assert.ok(Array.isArray(value), `${what} is a list`);
  return value.map((item) => {
    assert.ok(isRecord(item), `each of ${what} is an object`);
    return item;
  });
}

/** The ruleset's rules by type; each type at most once. */
function rulesOf(ruleset: JsonRecord): ReadonlyMap<string, JsonRecord> {
  const rules = new Map<string, JsonRecord>();
  for (const rule of records(ruleset['rules'], 'rules')) {
    const type = stringField(rule, 'type');
    assert.ok(type !== undefined && !rules.has(type), `rule type ${String(type)} named once`);
    rules.set(type, recordField(rule, 'parameters') ?? {});
  }
  return rules;
}

/** GitHub Actions' app id: a required check from any other app with the same name does not satisfy it. */
const GITHUB_ACTIONS = 15368;
/**
 * Who may skip a ruleset of main, each only through a pull request: the admin repository role (the maintainer) and the
 * teamrig-release GitHub App, which the release merge workflow merges the release pull request as (RELEASE_APP_ID).
 */
const PULL_REQUEST_BYPASS = [
  { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' },
  { actor_id: 5865151, actor_type: 'Integration', bypass_mode: 'pull_request' },
];

const main = readRecord('.github/rulesets/main.json');
const checks = readRecord('.github/rulesets/main-checks.json');
const review = readRecord('.github/rulesets/main-review.json');

describe('rulesets for main', () => {
  it('all three guard the default branch and are on', () => {
    for (const ruleset of [main, checks, review]) {
      assert.equal(ruleset['target'], 'branch');
      assert.equal(ruleset['enforcement'], 'active');
      assert.deepEqual(recordField(ruleset, 'conditions'), { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } });
    }
  });

  it('a ruleset anyone may bypass holds neither the CI check nor linear history, so no merge skips them (T4916)', () => {
    // A bypass skips every rule of its ruleset: CI and linear history live where the bypass list is empty.
    for (const ruleset of [main, review]) {
      const rules = rulesOf(ruleset);
      assert.notDeepEqual(ruleset['bypass_actors'], []);
      assert.equal(rules.has('required_status_checks'), false, String(ruleset['name']));
      assert.equal(rules.has('required_linear_history'), false, String(ruleset['name']));
    }
    assert.deepEqual(checks['bypass_actors'], [], 'no one bypasses main checks, the maintainer and the release App included');
  });

  it('main lets no one push, force-push or delete, and lands a pull request only through the rebasing merge queue', () => {
    const rules = rulesOf(main);
    assert.deepEqual([...rules.keys()].sort(), ['deletion', 'merge_queue', 'non_fast_forward', 'pull_request']);
    assert.deepEqual(main['bypass_actors'], PULL_REQUEST_BYPASS);
    assert.equal(rules.get('merge_queue')?.['merge_method'], 'REBASE');
    assert.deepEqual(rules.get('pull_request')?.['allowed_merge_methods'], ['rebase'], 'rebase merges keep the history linear');
    // Set by the file, as live has it, so a re-import never falls back to GitHub's default for the key.
    assert.equal(rules.get('pull_request')?.['require_extra_approval_for_unattributed_changes'], true);
  });

  it('main checks lands only a pull request whose summary check from GitHub Actions passed, on a linear history', () => {
    const rules = rulesOf(checks);
    assert.deepEqual([...rules.keys()].sort(), ['deletion', 'non_fast_forward', 'required_linear_history', 'required_status_checks']);
    const required = rules.get('required_status_checks') ?? {};
    // The merge queue tests each pull request on the newest main, so the branch need not be up to date itself.
    assert.equal(required['strict_required_status_checks_policy'], false);
    const summary = /^ {2}summary:\n {4}name: (.+)$/m.exec(read('.github/workflows/ci.yml'))?.[1];
    assert.ok(summary !== undefined, "ci.yml's summary job has a name");
    assert.deepEqual(required['required_status_checks'], [{ context: summary, integration_id: GITHUB_ACTIONS }]);
  });

  it('main review asks a code owner to approve the last push, which only the maintainer and the release App bypass', () => {
    const rules = rulesOf(review);
    assert.deepEqual([...rules.keys()], ['pull_request']);
    const pull = rules.get('pull_request') ?? {};
    assert.equal(pull['required_approving_review_count'], 1);
    assert.equal(pull['require_code_owner_review'], true);
    assert.equal(pull['require_last_push_approval'], true);
    assert.equal(pull['dismiss_stale_reviews_on_push'], true);
    assert.equal(pull['require_extra_approval_for_unattributed_changes'], true);
    assert.deepEqual(pull['allowed_merge_methods'], ['rebase']);
    assert.deepEqual(review['bypass_actors'], PULL_REQUEST_BYPASS);
  });

  it("CODEOWNERS makes the repository's owner the code owner of every path", () => {
    const slug = Object.keys(readRecord('tools/ship/repos.json')).find((name) => name.endsWith('/teamrig'));
    assert.ok(slug !== undefined, 'repos.json names this repository');
    const owners = read('.github/CODEOWNERS').split(/\r?\n/).filter((line) => line !== '' && !line.startsWith('#'));
    assert.deepEqual(owners, [`* @${slug.split('/')[0] ?? ''}`]);
  });
});

describe('rulesets for releases', () => {
  const branch = readRecord('.github/rulesets/release.json');
  const tags = readRecord('.github/rulesets/release-tags.json');
  const markers = readRecord('.github/rulesets/release-please-tags.json');
  const deployKey = [{ actor_id: null, actor_type: 'DeployKey', bypass_mode: 'always' }];

  it('are on; only the deploy key the publish job pushes with gets past the branch and the v* tags', () => {
    for (const ruleset of [branch, tags, markers]) assert.equal(ruleset['enforcement'], 'active');
    assert.deepEqual(branch['bypass_actors'], deployKey);
    assert.deepEqual(tags['bypass_actors'], deployKey);
    assert.deepEqual(markers['bypass_actors'], []);
  });

  it('the release and preview branches, which installs read, only the publish job can create, push, rewrite or delete', () => {
    assert.equal(branch['target'], 'branch');
    assert.deepEqual(recordField(branch, 'conditions'), { ref_name: { include: ['refs/heads/release', 'refs/heads/preview'], exclude: [] } });
    assert.deepEqual([...rulesOf(branch).keys()].sort(), ['creation', 'deletion', 'non_fast_forward', 'update']);
  });

  it("a build's v<version> tag, which an install can pin, only the publish job creates, and no one moves or deletes", () => {
    assert.equal(tags['target'], 'tag');
    assert.deepEqual(recordField(tags, 'conditions'), { ref_name: { include: ['refs/tags/v*'], exclude: [] } });
    assert.deepEqual([...rulesOf(tags).keys()].sort(), ['creation', 'deletion', 'non_fast_forward', 'update']);
  });

  it("main's teamrig-v<version> marker, which release-please makes with the job's token, no one moves or deletes", () => {
    assert.equal(markers['target'], 'tag');
    assert.deepEqual(recordField(markers, 'conditions'), { ref_name: { include: ['refs/tags/teamrig-v*'], exclude: [] } });
    assert.deepEqual([...rulesOf(markers).keys()].sort(), ['deletion', 'non_fast_forward', 'update']);
  });
});
