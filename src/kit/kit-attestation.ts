import { join } from 'node:path';
import type { Files } from '../core/files.ts';
import { isRecord, recordField, stringField } from '../core/guards.ts';
import type { ProgramRunner } from '../core/program-runner.ts';
import { CLIENT_MANIFEST, clientFileHash } from '../exec/client-integrity.ts';
import { KIT_RELEASE_REPO, runFailure, type KitRelease } from './kit-release.ts';

/**
 * The check `teamrig kit update` makes before it installs a release (T5278 design D, C3): the release's integrity
 * list, which holds the sha256 of every dist file, carries a build provenance attestation that this repository's
 * release workflow signed on main, its subject named by the release's tag. `gh attestation verify` checks the
 * signature, the workflow and the ref; this code checks the subject's name and digest in what gh verified, since the
 * run's source commit is main's head when it started and so does not tie the attestation to the tag.
 */

/** The workflow that signs each release's attestation, as a path in the release repository. */
export const KIT_RELEASE_WORKFLOW = '.github/workflows/release.yml';

/** The ref the release workflow runs on for a release. */
export const KIT_RELEASE_REF = 'refs/heads/main';

/** The release repository as `<owner>/<name>`, read from its clone URL; undefined for a URL of another shape. */
export function releaseSlugOf(url: string): string | undefined {
  const prefix = 'https://github.com/';
  if (!url.startsWith(prefix)) return undefined;
  const path = url.slice(prefix.length).replace(/\.git$/u, '');
  return /^[\w.-]+\/[\w.-]+$/u.test(path) ? path : undefined;
}

/** The subject name the release workflow attests a release's integrity list under. */
export function attestedListName(version: string): string {
  return `teamrig-v${version}.integrity.json`;
}

/** The predicate type of the build provenance the release workflow signs; another type proves nothing about the build. */
export const KIT_PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1';

/**
 * The `gh` arguments that verify `file`'s attestation: this repository, its release workflow, main, a hosted runner,
 * SLSA build provenance. `--signer-workflow` alone does not pin the ref: a release.yml run on another branch passes it.
 */
export function attestationArgs(file: string, slug: string): readonly string[] {
  return [
    'attestation',
    'verify',
    file,
    '--repo',
    slug,
    '--signer-workflow',
    `${slug}/${KIT_RELEASE_WORKFLOW}`,
    '--source-ref',
    KIT_RELEASE_REF,
    '--deny-self-hosted-runners',
    '--predicate-type',
    KIT_PROVENANCE_PREDICATE,
    '--format',
    'json',
  ];
}

/** A subject an attestation names: its name and sha256. */
export interface AttestedSubject {
  readonly name: string;
  readonly sha256: string;
}

/** Each subject of each statement gh's JSON output says it verified; empty when the text is no such output. */
export function attestedSubjects(text: string): readonly AttestedSubject[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const subjects: AttestedSubject[] = [];
  for (const entry of value) {
    const result = isRecord(entry) ? recordField(entry, 'verificationResult') : undefined;
    const statement = result === undefined ? undefined : recordField(result, 'statement');
    const listed: unknown = statement?.['subject'];
    if (!Array.isArray(listed)) continue;
    for (const subject of listed) {
      if (!isRecord(subject)) continue;
      const name = stringField(subject, 'name');
      const digest = recordField(subject, 'digest');
      const sha256 = digest === undefined ? undefined : stringField(digest, 'sha256');
      if (name !== undefined && sha256 !== undefined) subjects.push({ name, sha256 });
    }
  }
  return subjects;
}

/** The ports the check takes: gh by its absolute path, the runner that starts it, and the files it reads and writes. */
export interface KitAttestationPorts {
  readonly gh: string;
  readonly run: ProgramRunner;
  readonly files: Pick<Files, 'read' | 'write'>;
}

export type AttestationCheck = { readonly kind: 'verified'; readonly sha256: string } | { readonly kind: 'failed'; readonly why: string };

/**
 * Checks the attestation of the integrity list in `pluginRoot`, the clone of `release`. The list is copied, LF line
 * ends as the release workflow built it, to `folder` under its attested name, so a checkout that wrote CRLF still
 * hashes as the build did; `folder` is the clone's own, removed with it.
 */
export async function checkAttestation(ports: KitAttestationPorts, release: KitRelease, pluginRoot: string, folder: string): Promise<AttestationCheck> {
  const slug = releaseSlugOf(KIT_RELEASE_REPO);
  if (slug === undefined) {
    return { kind: 'failed', why: `the release repository ${KIT_RELEASE_REPO} is no repository gh can check an attestation in` };
  }
  const list = await ports.files.read(join(pluginRoot, CLIENT_MANIFEST));
  if (list === undefined) {
    return { kind: 'failed', why: `${release.tag} has no ${CLIENT_MANIFEST} to check the attestation of` };
  }
  const name = attestedListName(release.version);
  const copy = join(folder, name);
  await ports.files.write(copy, list.replace(/\r\n/gu, '\n'));
  const sha256 = clientFileHash(list);
  const verified = await ports.run({ program: ports.gh, args: attestationArgs(copy, slug) });
  if (verified.end.kind !== 'exited' || verified.end.code !== 0) {
    return { kind: 'failed', why: `${release.tag}'s attestation: ${runFailure('gh attestation verify', verified.end, verified.stderr)}` };
  }
  // gh matches by digest alone, so the subject's name is what ties the list to this tag. Exactly one verified subject
  // is taken: two would leave which release the list is unsaid, so more than one fails closed, as none does.
  const subjects = attestedSubjects(verified.stdout);
  if (subjects.length > 1) {
    return {
      kind: 'failed',
      why: `${release.tag}'s integrity list (sha256 ${sha256}) has ${String(subjects.length)} verified subjects, not exactly one, so which release it is stays unsaid`,
    };
  }
  const only = subjects[0];
  if (only === undefined || only.name !== name || only.sha256 !== sha256) {
    return {
      kind: 'failed',
      why: `${release.tag}'s integrity list (sha256 ${sha256}) is attested by the release workflow under no subject named ${name}, so the attestation is not this release's`,
    };
  }
  return { kind: 'verified', sha256 };
}
