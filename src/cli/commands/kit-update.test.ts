import assert from 'node:assert/strict';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import type { ProgramRequest, ProgramResult } from '../../core/program-runner.ts';
import { settingsWriteRefusal } from '../../core/settings-writers.ts';
import { clientFileHash } from '../../exec/client-integrity.ts';
import { attestationArgs, attestedListName } from '../../kit/kit-attestation.ts';
import { channelListingArgs, KIT_RELEASE_REPO } from '../../kit/kit-release.ts';
import { kitInstallLockPath } from '../../kit/kit-self-install.ts';
import { KIT_LOCK_BUSY, kitCurrentPath, kitVersionFolder, readKitCurrent } from '../../kit/kit-versions.ts';
import { cliLauncherPath, KIT_LAUNCHER_FILE } from '../../restore/cli-launcher.ts';
import { CLI_PID, CliHarness, KIT, type RunOptions } from '../../testing/cli-harness.ts';
import { FakePathProbe } from '../../testing/fake-processes.ts';
import { holdFileLock } from '../../testing/held-file-lock.ts';
import { writeKeptKitVersion, writeKitRelease } from '../../testing/kit-release.ts';
import { MemoryKitTree } from '../../testing/memory-kit-tree.ts';
import { EXIT } from '../runtime.ts';

const GIT = '/usr/bin/git';
const GH = '/usr/bin/gh';
const HEAD = 'a'.repeat(40);
const MOVED = 'd'.repeat(40);
const NEWER = '0.510.0';
const CURRENT = '0.509.0';
const CLONE = join(KIT, 'install', `kit-update-${CLI_PID}`);
const LAUNCHER = `// the kit launcher of ${NEWER}\n`;
const COPY = join(CLONE, attestedListName(NEWER));

function ok(stdout = ''): ProgramResult {
  return { end: { kind: 'exited', code: 0 }, stdout, stderr: '' };
}

describe('teamrig kit update', () => {
  let kit: CliHarness;
  let asked: ProgramRequest[];
  /** What the fake public repository lists: each branch head and release tag. */
  let listing: string;
  /** The commit a clone of the tag checks out. */
  let cloned: string;
  let cloneFails: boolean;
  /** The release whose name gh's verified attestation carries, or undefined when gh can verify none. */
  let attestedAs: string | undefined;

  /** A gh that verifies the copied list as attested under `attestedAs`'s name, with the copy's own digest. */
  function gh(request: ProgramRequest): ProgramResult {
    const list = kit.files.get(request.args[2] ?? '');
    if (attestedAs === undefined || list === undefined) return { end: { kind: 'exited', code: 1 }, stdout: '', stderr: 'no attestations found' };
    const subject = { name: attestedListName(attestedAs), digest: { sha256: clientFileHash(list) } };
    return ok(JSON.stringify([{ verificationResult: { statement: { subject: [subject] } } }]));
  }

  /** A git whose clone writes the release's built plugin folder, as the release branch holds it, and the gh above. */
  async function git(request: ProgramRequest): Promise<ProgramResult> {
    asked.push(request);
    if (request.program === GH) return gh(request);
    const [first, second] = request.args;
    if (first === 'ls-remote') return ok(listing);
    if (first === '-C' && request.args.includes('rev-parse')) return ok(`${cloned}\n`);
    if (second === 'advice.detachedHead=false') {
      if (cloneFails) return { end: { kind: 'exited', code: 128 }, stdout: '', stderr: 'fatal: Remote branch v0.510.0 not found' };
      const plugin = join(CLONE, 'plugins', 'teamrig');
      await writeKitRelease(kit.files, plugin, NEWER);
      await kit.files.write(join(plugin, KIT_LAUNCHER_FILE), LAUNCHER);
      return ok();
    }
    return { end: { kind: 'exited', code: 1 }, stdout: '', stderr: `unexpected git ${request.args.join(' ')}` };
  }

  function options(env: Readonly<Record<string, string>> = {}): RunOptions {
    return { kitTree: new MemoryKitTree(kit.files), program: git, probe: new FakePathProbe({ files: [GIT, GH] }), env: { PATH: '/usr/bin', ...env } };
  }

  beforeEach(async () => {
    kit = new CliHarness();
    asked = [];
    listing = [`${HEAD}\trefs/heads/release`, `${HEAD}\trefs/tags/v${NEWER}`, `${MOVED}\trefs/heads/preview`, `${MOVED}\trefs/tags/v0.511.0`].join('\n');
    cloned = HEAD;
    cloneFails = false;
    attestedAs = NEWER;
    await writeKeptKitVersion(kit.files, KIT, CURRENT);
    await kit.files.write(join(kitVersionFolder(KIT, CURRENT), KIT_LAUNCHER_FILE), `// the kit launcher of ${CURRENT}\n`);
    const use = await kit.run(['kit', 'use', '--latest', '--yes'], options());
    assert.equal(use.code, EXIT.ok, use.stdout.join('\n'));
  });

  it("shows the stable channel's newest release and writes nothing without --yes", async () => {
    const result = await kit.run(['kit', 'update'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.deepEqual(result.stdout, [
      `PREVIEW nothing written (add --yes to write): clone teamrig ${NEWER} (github-release v${NEWER} ${HEAD}) of the stable channel into ${kitVersionFolder(KIT, NEWER)}, checking its attestation with gh; current ${CURRENT} -> ${NEWER} unless a pin holds it`,
    ]);
    assert.deepEqual(asked, [{ program: GIT, args: channelListingArgs('release') }]);
    assert.equal(kit.files.get(kitCurrentPath(KIT)), `${CURRENT}\n`);
  });

  it('clones the release by its tag, checks its attestation, installs it as current, writes its launcher and removes the clone', async () => {
    const result = await kit.run(['kit', 'update', '--yes'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    const list = kit.files.get(join(kitVersionFolder(KIT, NEWER), 'dist', 'integrity.json')) ?? '';
    assert.deepEqual(result.stdout, [
      `VERIFIED v${NEWER}: the release workflow attested its integrity list, sha256 ${clientFileHash(list)}`,
      `WROTE current ${NEWER} (was ${CURRENT}): teamrig ${NEWER} (github-release v${NEWER} ${HEAD})`,
      `WROTE ${cliLauncherPath(KIT)}: the kit launcher of teamrig ${NEWER}`,
    ]);
    assert.deepEqual(
      asked.map((each) => each.args),
      [channelListingArgs('release'), ['-c', 'advice.detachedHead=false', 'clone', '-q', '--depth', '1', '--branch', `v${NEWER}`, KIT_RELEASE_REPO, CLONE],
        ['-C', CLONE, 'rev-parse', 'HEAD'],
        attestationArgs(COPY, 'teamrig/teamrig'),
      ],
    );
    assert.equal(asked.at(-1)?.program, GH);
    assert.deepEqual((await readKitCurrent(kit.files, KIT))?.source, { kind: 'github-release', tag: `v${NEWER}`, commit: HEAD });
    assert.equal(kit.files.get(cliLauncherPath(KIT)), LAUNCHER);
    assert.deepEqual(await kit.files.list(CLONE), []);
  });

  it('follows the preview branch with --channel preview and refuses a channel it does not know', async () => {
    const preview = await kit.run(['kit', 'update', '--channel', 'preview'], options());
    assert.match(preview.stdout[0] ?? '', /^PREVIEW .*teamrig 0\.511\.0 \(github-release v0\.511\.0 d{40}\) of the preview channel/u);
    const unknown = await kit.run(['kit', 'update', '--channel', 'main'], options());
    assert.equal(unknown.code, EXIT.usage);
  });

  it("says current is the channel's newest release, cloning nothing", async () => {
    listing = `${HEAD}\trefs/heads/release\n${HEAD}\trefs/tags/v${CURRENT}`;
    const result = await kit.run(['kit', 'update', '--yes'], options());
    assert.deepEqual([result.code, result.stdout], [EXIT.ok, [`UNCHANGED current ${CURRENT} is the stable channel's newest release v${CURRENT}`]]);
    assert.equal(asked.length, 1);
  });

  it('refuses a channel release older than current: only kit use moves down', async () => {
    listing = `${HEAD}\trefs/heads/release\n${HEAD}\trefs/tags/v0.508.0`;
    const result = await kit.run(['kit', 'update', '--yes'], options());
    assert.equal(result.code, EXIT.refused);
    assert.equal(
      result.stdout[0],
      `REFUSED teamrig kit update: the stable channel's v0.508.0 is older than current ${CURRENT}; an update never moves current down, teamrig kit use <version> does`,
    );
  });

  it('refuses a branch head with no release tag yet, and a listing git could not read', async () => {
    listing = `${MOVED}\trefs/heads/release\n${HEAD}\trefs/tags/v${NEWER}`;
    const untagged = await kit.run(['kit', 'update'], options());
    assert.equal(untagged.code, EXIT.refused);
    assert.match(untagged.stdout[0] ?? '', /^REFUSED teamrig kit update: the stable channel: the head of release, d{40}, carries no release tag yet; .*; nothing written$/u);
    const offline = await kit.run(['kit', 'update'], { ...options(), program: async () => ({ end: { kind: 'exited', code: 128 }, stdout: '', stderr: 'fatal: unable to access' }) });
    assert.deepEqual(offline.stdout, [`REFUSED teamrig kit update: git ls-remote ${KIT_RELEASE_REPO} failed (exit 128): fatal: unable to access; nothing written`]);
  });

  it('refuses a clone whose HEAD is not the listed commit and a failed clone, removing the clone and keeping current', async () => {
    cloned = MOVED;
    const moved = await kit.run(['kit', 'update', '--yes'], options());
    assert.deepEqual(moved.stdout, [`REFUSED teamrig kit update: the clone of v${NEWER} is at ${MOVED}, not the tag's commit ${HEAD}; nothing written`]);
    assert.deepEqual(await kit.files.list(CLONE), []);
    cloneFails = true;
    const failed = await kit.run(['kit', 'update', '--yes'], options());
    assert.deepEqual(failed.stdout, [`REFUSED teamrig kit update: git clone --branch v${NEWER} failed (exit 128): fatal: Remote branch v0.510.0 not found; nothing written`]);
    assert.equal(kit.files.get(kitCurrentPath(KIT)), `${CURRENT}\n`);
  });

  it('refuses where no git is on PATH, running nothing', async () => {
    const result = await kit.run(['kit', 'update'], { ...options(), probe: new FakePathProbe() });
    assert.deepEqual(result.stdout, ['REFUSED teamrig kit update: no git program is on PATH; install git and run this again; nothing written']);
    assert.deepEqual(asked, []);
  });

  it('refuses where no gh is on PATH, running nothing, unless --no-attestation is typed', async () => {
    const probe = new FakePathProbe({ files: [GIT] });
    const result = await kit.run(['kit', 'update', '--yes'], { ...options(), probe });
    assert.equal(result.code, EXIT.refused);
    assert.match(result.stdout[0] ?? '', /^REFUSED teamrig kit update: no gh program is on PATH, .*or add --no-attestation .*; nothing written$/u);
    assert.equal(asked.length, 0);
    const skipped = await kit.run(['kit', 'update', '--no-attestation', '--yes'], { ...options(), probe });
    assert.equal(skipped.code, EXIT.ok, skipped.stdout.join('\n'));
    assert.match(skipped.stdout[0] ?? '', /^NOTE the attestation check skipped \(--no-attestation\): /u);
    assert.equal(kit.files.get(kitCurrentPath(KIT)), `${NEWER}\n`);
    assert.ok(asked.every((request) => request.program === GIT));
  });

  it('says in its preview what --no-attestation skips, writing nothing', async () => {
    const result = await kit.run(['kit', 'update', '--no-attestation'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.doesNotMatch(result.stdout[0] ?? '', /checking its attestation/u);
    assert.match(result.stdout[1] ?? '', /^NOTE the attestation check skipped \(--no-attestation\): nothing shows the release workflow built v0\.510\.0, only that its tag names it$/u);
    assert.equal(kit.files.get(kitCurrentPath(KIT)), `${CURRENT}\n`);
  });

  it("refuses an attestation under another release's name and one gh cannot verify, removing the clone and keeping current", async () => {
    attestedAs = CURRENT;
    const other = await kit.run(['kit', 'update', '--yes'], options());
    assert.equal(other.code, EXIT.refused);
    assert.match(other.stdout[0] ?? '', /^REFUSED teamrig kit update: v0\.510\.0's integrity list \(sha256 [0-9a-f]{64}\) is attested by the release workflow under no subject named teamrig-v0\.510\.0\.integrity\.json, .*; nothing written$/u);
    assert.deepEqual(await kit.files.list(CLONE), []);
    attestedAs = undefined;
    const unverified = await kit.run(['kit', 'update', '--yes'], options());
    assert.match(unverified.stdout[0] ?? '', /^REFUSED teamrig kit update: v0\.510\.0's attestation: gh attestation verify failed \(exit 1\): no attestations found; nothing written$/u);
    assert.equal(kit.files.get(kitCurrentPath(KIT)), `${CURRENT}\n`);
  });

  it('keeps a pinned current, naming the pin', async () => {
    const pin = await kit.run(['kit', 'use', CURRENT, '--yes'], options());
    assert.equal(pin.code, EXIT.ok, pin.stdout.join('\n'));
    const result = await kit.run(['kit', 'update', '--yes'], options());
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.ok((result.stdout[0] ?? '').startsWith(`VERIFIED v${NEWER}: `), result.stdout.join('\n'));
    assert.ok((result.stdout[1] ?? '').startsWith(`NOTE teamrig pinned at ${CURRENT}; `), result.stdout.join('\n'));
    assert.equal(kit.files.get(kitCurrentPath(KIT)), `${CURRENT}\n`);
  });

  it('refuses its write where an agent runs it', async () => {
    const result = await kit.run(['kit', 'update', '--yes'], options({ CLAUDECODE: '1' }));
    assert.deepEqual(result.stdout, [`REFUSED ${settingsWriteRefusal('kit update', 'CLAUDECODE')}`]);
    assert.deepEqual(asked, []);
  });

  it('refuses, keeping current, while another process holds the install lock past the wait', async () => {
    await holdFileLock(kit, kitInstallLockPath(KIT));
    const result = await kit.run(['kit', 'update', '--yes'], options());
    assert.equal(result.code, EXIT.refused);
    assert.deepEqual(result.stdout.slice(1), [`REFUSED teamrig kit update: ${KIT_LOCK_BUSY}`]);
    assert.ok((result.stdout[0] ?? '').startsWith(`VERIFIED v${NEWER}: `), result.stdout.join('\n'));
    assert.equal(kit.files.get(kitCurrentPath(KIT)), `${CURRENT}\n`);
    assert.deepEqual(await kit.files.list(CLONE), []);
  });
});
