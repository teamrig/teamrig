import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isRecord, recordField, stringField, type JsonRecord } from '../lib/guards.ts';

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/release.yml');

/** Each job's text, from its `  <id>:` line to the next job's. */
const jobs: ReadonlyMap<string, string> = new Map(
  (workflow.split(/^jobs:\n/m)[1] ?? '')
    .split(/^(?= {2}[\w-]+:$)/m)
    .map((block) => [/^ {2}([\w-]+):$/m.exec(block)?.[1] ?? '', block]),
);
const job = (id: string): string => {
  const text = jobs.get(id);
  assert.ok(text !== undefined, `release.yml has the job ${id}`);
  return text;
};

/** A job's own permissions block, as `name: level` lines; empty when it keeps the workflow's read-only token. */
const permissionsOf = (text: string): readonly string[] => [...(/^ {4}permissions:\n((?: {6}.+\n)+)/m.exec(text)?.[1] ?? '').matchAll(/^ {6}(.+)$/gm)].map((match) => match[1] ?? '');

function readRecord(path: string): JsonRecord {
  const parsed: unknown = JSON.parse(read(path));
  assert.ok(isRecord(parsed), `${path} is a JSON object`);
  return parsed;
}

describe('release.yml', () => {
  it('runs on each push to main, hourly and by hand', () => {
    assert.match(workflow, /^on:\n(?: {2}#.*\n)*? {2}push:\n {4}branches: \[main\]\n {2}schedule:\n {4}- cron: '1 \* \* \* \*'\n {2}workflow_dispatch:\n {4}inputs:\n {6}main-as-is:\n(?: {8}.+\n)+\n/m);
  });

  it('moves the release pull request only when the slot gate opens, so a push to main never restarts its ci', () => {
    const text = job('release-please');
    // The gate reads the release pull request's head with the job's token (T5330).
    assert.match(text, /^ {6}- id: gate\n {8}run: node tools\/release\/pull-update-cli\.ts\n {8}env:\n {10}GITHUB_TOKEN: \$\{\{ github\.token \}\}\n/m);
    assert.match(text, /^ {10}skip-github-pull-request: \$\{\{ steps\.gate\.outputs\.update != 'true' \}\}$/m);
    assert.ok(text.indexOf('id: gate') < text.indexOf('id: release'), 'the gate runs before release-please');
  });

  it("can publish main as it stands, for the first release, never by default", () => {
    assert.match(workflow, /^ {6}main-as-is:\n {8}description: .+\n {8}type: boolean\n {8}default: false\n/m);
  });

  it('runs one release at a time and never cancels one half-way', () => {
    assert.match(workflow, /^concurrency:\n {2}group: release\n {2}cancel-in-progress: false\n/m);
  });

  it('has the release pull request, build and publish jobs, each stopping within 20 minutes', () => {
    assert.deepEqual([...jobs.keys()], ['release-please', 'build', 'publish']);
    for (const [id, text] of jobs) assert.match(text, /^ {4}timeout-minutes: 20$/m, id);
  });

  it('keeps the release pull request on main, with only the writes it needs', () => {
    const text = job('release-please');
    assert.match(text, /^ {4}if: \$\{\{ !github\.event\.repository\.private && github\.ref == 'refs\/heads\/main' && !inputs\.main-as-is \}\}$/m);
    assert.deepEqual(permissionsOf(text), ['contents: read', 'pull-requests: read']);
    assert.match(text, /^ {10}config-file: release-please-config\.json\n {10}manifest-file: \.release-please-manifest\.json$/m);
  });

  it("writes the release pull request with the teamrig-release App's token, whose pull request runs GitHub never holds (T5390)", () => {
    const text = job('release-please');
    assert.match(text, /^ {4}environment: release-merge$/m);
    assert.match(
      text,
      /^ {6}- id: token\n {8}run: node tools\/release\/app-token-cli\.ts mint\n {8}env:\n {10}APP_ID: \$\{\{ vars\.RELEASE_APP_ID \}\}\n {10}APP_KEY: \$\{\{ secrets\.RELEASE_APP_KEY \}\}\n/m,
    );
    assert.match(text, /^ {8}with:\n {10}token: \$\{\{ steps\.token\.outputs\.token \}\}\n/m);
    assert.ok(text.indexOf('id: token') < text.indexOf('id: release'), 'the token is minted before release-please');
    // The gate reads with the job's token alone, so the App's key reaches no step before the mint.
    assert.ok(text.indexOf('id: gate') < text.indexOf('id: token'), 'the gate runs before the mint');
  });

  it('revokes the App token after release-please, even when it failed', () => {
    const text = job('release-please');
    assert.match(text, /^ {6}- if: \$\{\{ always\(\) && steps\.token\.outputs\.token != '' \}\}\n {8}run: node tools\/release\/app-token-cli\.ts revoke\n {8}env:\n {10}TOKEN: \$\{\{ steps\.token\.outputs\.token \}\}\n/m);
    assert.ok(text.indexOf('id: release') < text.indexOf('app-token-cli.ts revoke'), 'the revoke runs last');
  });

  it('starts no ci run by hand, as the App-written pull request starts its own', () => {
    assert.doesNotMatch(workflow, /gh workflow run/);
    assert.doesNotMatch(workflow, /fromJSON\(/);
  });

  it('builds with the read-only token, and no package script runs at install', () => {
    const text = job('build');
    assert.deepEqual(permissionsOf(text), []);
    assert.match(
      text,
      /^ {4}if: \$\{\{ always\(\) && !github\.event\.repository\.private && github\.ref == 'refs\/heads\/main' && \(needs\.release-please\.outputs\.release_created == 'true' \|\| \(inputs\.main-as-is && needs\.release-please\.result == 'skipped'\)\) \}\}$/m,
    );
    assert.match(text, /^ {10}ref: \$\{\{ needs\.release-please\.outputs\.sha \|\| github\.sha \}\}$/m);
    assert.match(text, /^ {6}- run: npm ci --ignore-scripts$/m);
    assert.match(text, /^ {6}- run: npm run build$/m);
    assert.match(text, /^ {10}persist-credentials: false$/m);
  });

  it("takes the version from the built commit's plugin.json, refusing one release-please did not cut", () => {
    const text = job('build');
    assert.match(text, /^ {6}- id: version\n {8}run: node tools\/release\/version-cli\.ts --expect "\$EXPECTED" >> "\$GITHUB_OUTPUT"\n {8}env:\n {10}EXPECTED: \$\{\{ needs\.release-please\.outputs\.version \}\}\n/m);
    assert.match(text, /^ {6}version: \$\{\{ steps\.version\.outputs\.version \}\}\n {6}sha: \$\{\{ steps\.version\.outputs\.sha \}\}\n/m);
  });

  it('publishes to the preview branch, started from the release branch, with a read-only token, running no npm package, the commit and version the build took', () => {
    const text = job('publish');
    assert.deepEqual(permissionsOf(text), ['contents: read']);
    assert.match(text, /^ {4}needs: build\n {4}if: \$\{\{ always\(\) && needs\.build\.result == 'success' \}\}$/m);
    assert.match(text, /^ {10}VERSION: \$\{\{ needs\.build\.outputs\.version \}\}\n {10}SOURCE: \$\{\{ needs\.build\.outputs\.sha \}\}$/m);
    assert.doesNotMatch(text, /^ {6}- run: .*\bnp[mx]\b/m);
    assert.match(text, /^ {10}ref: \$\{\{ needs\.build\.outputs\.sha \}\}$/m);
    assert.match(text, /^ {6}- run: node tools\/release\/publish-cli\.ts --version "\$VERSION" --source "\$SOURCE" --branch preview --seed release$/m);
  });

  it("pushes with the release environment's deploy key, the one actor the release rulesets let through", () => {
    const text = job('publish');
    assert.match(text, /^ {4}environment: release$/m);
    assert.match(text, /^ {10}ssh-key: \$\{\{ secrets\.RELEASE_DEPLOY_KEY \}\}$/m);
    // The release pull request job holds the App's key alone, in its own environment (T5390); build holds no secret.
    assert.doesNotMatch(job('release-please'), /secrets\.(?!RELEASE_APP_KEY\b)|environment: (?!release-merge$)/m);
    assert.doesNotMatch(job('build'), /secrets\.|environment:/);
  });

  it('keeps the push key only in the publish job: every other checkout drops its credentials', () => {
    for (const [id, text] of jobs) {
      if (id === 'publish') continue;
      const checkouts = text.match(/uses: actions\/checkout@/g)?.length ?? 0;
      const dropped = text.match(/^ {10}persist-credentials: false$/gm)?.length ?? 0;
      assert.equal(dropped, checkouts, id);
    }
  });
});

describe('release-please-config.json', () => {
  const config = readRecord('release-please-config.json');
  const root = recordField(recordField(config, 'packages') ?? {}, '.') ?? {};

  it('raises the plugin version in plugin.json and src/core/version.ts, the files a test holds equal', () => {
    assert.deepEqual(root['extra-files'], [
      { type: 'json', path: 'plugins/teamrig/.claude-plugin/plugin.json', jsonpath: '$.version' },
      { type: 'generic', path: 'src/core/version.ts' },
    ]);
    assert.match(read('src/core/version.ts'), /^export const KIT_VERSION = '\d+\.\d+\.\d+';$/m);
  });

  it('marks the version in a release-please block of its own lines, so a work commit never edits the version line', () => {
    // A block with no end marker runs to the end of the file in release-please 17.6.0's generic updater.
    const version = read('src/core/version.ts');
    assert.match(version, /^\/\/ x-release-please-start-version\b.*\n(?:(?!export const)[^\n]*\n)*export const KIT_VERSION = /);
    assert.doesNotMatch(version, /x-release-please-end|x-release-please-version/);
  });

  it('tags main teamrig-v<version>, leaving v<version> to the published build an install can pin', () => {
    assert.equal(stringField(root, 'component'), 'teamrig');
    assert.equal(root['include-component-in-tag'], true);
  });

  it('raises the minor for a breaking change while the version is 0.x, as the patch is for a fix', () => {
    assert.equal(root['bump-minor-pre-major'], true);
    assert.equal(root['bump-patch-for-minor-pre-major'], undefined);
  });

  it("signs off its commits as the teamrig-release App's bot, which writes them and the DCO gate reads as their author", () => {
    // 359619066 is the bot's user id (GET /users/teamrig-release[bot]), not the App's id.
    assert.equal(stringField(config, 'signoff'), 'teamrig-release[bot] <359619066+teamrig-release[bot]@users.noreply.github.com>');
  });

  it('starts from a commit of main, not from the whole history', () => {
    assert.match(stringField(config, 'bootstrap-sha') ?? '', /^[0-9a-f]{40}$/);
  });

  it("holds main's version in its manifest, the one plugin.json and version.ts hold: only a release pull request raises it", () => {
    const released = stringField(readRecord('.release-please-manifest.json'), '.') ?? '';
    assert.match(released, /^\d+\.\d+\.\d+$/);
    assert.equal(stringField(readRecord('plugins/teamrig/.claude-plugin/plugin.json'), 'version'), released, 'plugin.json');
    assert.match(read('src/core/version.ts'), new RegExp(`^export const KIT_VERSION = '${released.replaceAll('.', '\\.')}';`, 'm'), 'version.ts');
  });
});
