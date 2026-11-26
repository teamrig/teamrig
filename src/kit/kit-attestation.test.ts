import assert from 'node:assert/strict';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import type { ProgramRequest, ProgramResult } from '../core/program-runner.ts';
import { CLIENT_MANIFEST, clientFileHash } from '../exec/client-integrity.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { attestationArgs, attestedListName, attestedSubjects, checkAttestation, KIT_RELEASE_WORKFLOW, releaseSlugOf } from './kit-attestation.ts';
import { KIT_RELEASE_REPO, type KitRelease } from './kit-release.ts';

const GH = '/usr/bin/gh';
const FOLDER = '/srv/ada/.teamrig/install/kit-update-7';
const PLUGIN = join(FOLDER, 'plugins', 'teamrig');
const RELEASE: KitRelease = { tag: 'v0.510.0', commit: 'a'.repeat(40), version: '0.510.0' };
const LIST = '{\n  "files": {\n    "dist/cli/main.js": "abc"\n  }\n}\n';
const COPY = join(FOLDER, 'teamrig-v0.510.0.integrity.json');

type Subject = { readonly name: string; readonly sha256: string };

/** One entry of gh's JSON output: a verified attestation naming these subjects. */
function verifiedEntry(subjects: readonly Subject[]): object {
  return {
    attestation: { bundle: {} },
    verificationResult: {
      statement: { _type: 'https://in-toto.io/Statement/v1', subject: subjects.map(({ name, sha256 }) => ({ name, digest: { sha256 } })) },
    },
  };
}

/** gh's JSON output for one verified attestation naming these subjects. */
function verifiedOutput(subjects: readonly Subject[]): string {
  return JSON.stringify([verifiedEntry(subjects)]);
}

describe('kit attestation', () => {
  let files: MemoryFiles;
  let asked: ProgramRequest[];
  let answer: ProgramResult;

  function run(request: ProgramRequest): Promise<ProgramResult> {
    asked.push(request);
    return Promise.resolve(answer);
  }

  beforeEach(async () => {
    files = new MemoryFiles();
    asked = [];
    answer = { end: { kind: 'exited', code: 0 }, stdout: verifiedOutput([{ name: attestedListName('0.510.0'), sha256: clientFileHash(LIST) }]), stderr: '' };
    await files.write(join(PLUGIN, CLIENT_MANIFEST), LIST);
  });

  it('reads the release repository as owner/name from its clone URL, and nothing else', () => {
    assert.equal(releaseSlugOf(KIT_RELEASE_REPO), 'teamrig/teamrig');
    assert.equal(releaseSlugOf('https://github.com/ada/tool'), 'ada/tool');
    assert.equal(releaseSlugOf('git@github.com:ada/tool.git'), undefined);
    assert.equal(releaseSlugOf('https://github.com/ada/tool/tree/main'), undefined);
  });

  it('verifies against this repository, its release workflow, main and a hosted runner, as JSON', () => {
    assert.deepEqual(attestationArgs('/f', 'ada/tool'), [
      'attestation',
      'verify',
      '/f',
      '--repo',
      'ada/tool',
      '--signer-workflow',
      `ada/tool/${KIT_RELEASE_WORKFLOW}`,
      '--source-ref',
      'refs/heads/main',
      '--deny-self-hosted-runners',
      '--predicate-type',
      'https://slsa.dev/provenance/v1',
      '--format',
      'json',
    ]);
  });

  it("reads each verified statement's subjects, skipping what is no subject", () => {
    const text = JSON.stringify([
      { verificationResult: { statement: { subject: [{ name: 'a', digest: { sha256: '1' } }, { name: 'b' }, 'c'] } } },
      { verificationResult: {} },
      'other',
      { verificationResult: { statement: { subject: [{ name: 'd', digest: { sha256: '2' } }] } } },
    ]);
    assert.deepEqual(attestedSubjects(text), [
      { name: 'a', sha256: '1' },
      { name: 'd', sha256: '2' },
    ]);
    assert.deepEqual(attestedSubjects('not json'), []);
    assert.deepEqual(attestedSubjects('{"verificationResult":{}}'), []);
  });

  it('checks a copy of the list under its attested name and passes when gh verified that name and digest', async () => {
    const check = await checkAttestation({ gh: GH, run, files }, RELEASE, PLUGIN, FOLDER);
    assert.deepEqual(check, { kind: 'verified', sha256: clientFileHash(LIST) });
    assert.deepEqual(asked, [{ program: GH, args: attestationArgs(COPY, 'teamrig/teamrig') }]);
    assert.equal(files.get(COPY), LIST);
  });

  it('copies a list checked out with CRLF line ends as the build wrote it, with LF', async () => {
    await files.write(join(PLUGIN, CLIENT_MANIFEST), LIST.replace(/\n/gu, '\r\n'));
    const check = await checkAttestation({ gh: GH, run, files }, RELEASE, PLUGIN, FOLDER);
    assert.equal(check.kind, 'verified');
    assert.equal(files.get(COPY), LIST);
  });

  it("refuses an attestation of the same list under an older release's name", async () => {
    answer = { ...answer, stdout: verifiedOutput([{ name: attestedListName('0.509.0'), sha256: clientFileHash(LIST) }]) };
    assert.deepEqual(await checkAttestation({ gh: GH, run, files }, RELEASE, PLUGIN, FOLDER), {
      kind: 'failed',
      why: `v0.510.0's integrity list (sha256 ${clientFileHash(LIST)}) is attested by the release workflow under no subject named teamrig-v0.510.0.integrity.json, so the attestation is not this release's`,
    });
  });

  it('refuses a subject of the right name with another digest', async () => {
    answer = { ...answer, stdout: verifiedOutput([{ name: attestedListName('0.510.0'), sha256: 'f'.repeat(64) }]) };
    assert.equal((await checkAttestation({ gh: GH, run, files }, RELEASE, PLUGIN, FOLDER)).kind, 'failed');
  });

  it("refuses a statement naming this release's subject beside another one, as not exactly one subject", async () => {
    const subject = { name: attestedListName('0.510.0'), sha256: clientFileHash(LIST) };
    answer = { ...answer, stdout: verifiedOutput([subject, { name: attestedListName('0.509.0'), sha256: clientFileHash(LIST) }]) };
    assert.deepEqual(await checkAttestation({ gh: GH, run, files }, RELEASE, PLUGIN, FOLDER), {
      kind: 'failed',
      why: `v0.510.0's integrity list (sha256 ${clientFileHash(LIST)}) has 2 verified subjects, not exactly one, so which release it is stays unsaid`,
    });
  });

  it("refuses two verified attestations that both match this release's subject, as more than one match", async () => {
    const entry = verifiedEntry([{ name: attestedListName('0.510.0'), sha256: clientFileHash(LIST) }]);
    answer = { ...answer, stdout: JSON.stringify([entry, entry]) };
    const check = await checkAttestation({ gh: GH, run, files }, RELEASE, PLUGIN, FOLDER);
    assert.equal(check.kind, 'failed');
    assert.match(check.kind === 'failed' ? check.why : '', /has 2 verified subjects, not exactly one/u);
  });

  it('refuses a verified output that names no subject at all', async () => {
    answer = { ...answer, stdout: verifiedOutput([]) };
    const check = await checkAttestation({ gh: GH, run, files }, RELEASE, PLUGIN, FOLDER);
    assert.equal(check.kind, 'failed');
    assert.match(check.kind === 'failed' ? check.why : '', /under no subject named teamrig-v0\.510\.0\.integrity\.json/u);
  });

  it("refuses when gh could not verify, naming its exit and last line", async () => {
    answer = { end: { kind: 'exited', code: 1 }, stdout: '', stderr: 'Loaded digest sha256:abc\nno attestations found\n' };
    assert.deepEqual(await checkAttestation({ gh: GH, run, files }, RELEASE, PLUGIN, FOLDER), {
      kind: 'failed',
      why: "v0.510.0's attestation: gh attestation verify failed (exit 1): no attestations found",
    });
  });

  it('refuses a release with no integrity list, running no gh', async () => {
    const empty = new MemoryFiles();
    assert.deepEqual(await checkAttestation({ gh: GH, run, files: empty }, RELEASE, PLUGIN, FOLDER), {
      kind: 'failed',
      why: `v0.510.0 has no ${CLIENT_MANIFEST} to check the attestation of`,
    });
    assert.deepEqual(asked, []);
  });
});
