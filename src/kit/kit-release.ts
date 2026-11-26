import { join } from 'node:path';
import type { ProgramRunner } from '../core/program-runner.ts';
import { compareVersions, parseVersion, type Version } from '../core/release-version.ts';
import type { ShellEnd } from '../core/shell-end.ts';
import { RELEASE_REPO } from '../install/install-teamrig.ts';

/**
 * Where `teamrig kit update` finds a newer teamrig: the release tag at the head of a channel's branch in the public
 * repository, cloned by that tag, never by the moving branch, with the clone's commit checked against the tag's. The
 * code doing these checks is the teamrig already installed, so a later release is taken only as git names it.
 */

/** The public repository the release workflow publishes to, the one the install script clones. */
export const KIT_RELEASE_REPO = RELEASE_REPO;

/** Each channel by the branch the release workflow moves: stable to each stable release, preview to every release. */
export const KIT_CHANNELS = { stable: 'release', preview: 'preview' } as const satisfies Record<string, string>;

export type KitChannel = keyof typeof KIT_CHANNELS;

export function isKitChannel(name: string): name is KitChannel {
  return Object.hasOwn(KIT_CHANNELS, name);
}

/** A release as its tag names it: `v<version>`, the commit it points at, and the version. */
export interface KitRelease {
  readonly tag: string;
  readonly commit: string;
  readonly version: string;
}

export type ChannelRelease = { readonly kind: 'release'; readonly release: KitRelease } | { readonly kind: 'none'; readonly why: string };

const COMMIT = /^[0-9a-f]{40}$/u;
const TAG_REF = /^refs\/tags\/v(\d+\.\d+\.\d+)(\^\{\})?$/u;

/** The `git ls-remote` arguments that list a channel's branch head and every release tag, peeled. */
export function channelListingArgs(branch: string): readonly string[] {
  return ['ls-remote', KIT_RELEASE_REPO, `refs/heads/${branch}`, 'refs/tags/v*'];
}

/**
 * The release at the head of `branch` in a `git ls-remote` listing: the newest `v<version>` tag whose commit (the
 * peeled `^{}` line of an annotated tag, else the tag's own) is the branch head. None when the branch is missing or its
 * head carries no release tag, as between a release's push and its tag.
 */
export function channelReleaseOf(listing: string, branch: string): ChannelRelease {
  let head: string | undefined;
  const tagged = new Map<string, { readonly version: Version; readonly text: string; readonly commit: string }>();
  for (const line of listing.split(/\r?\n/u)) {
    const [commit = '', ref = ''] = line.split('\t');
    if (!COMMIT.test(commit)) continue;
    if (ref === `refs/heads/${branch}`) {
      head = commit;
      continue;
    }
    const match = TAG_REF.exec(ref);
    const text = match?.[1];
    const version = text === undefined ? undefined : parseVersion(text);
    if (text === undefined || version === undefined) continue;
    const peeled = match?.[2] !== undefined;
    const seen = tagged.get(text);
    if (seen === undefined || peeled) {
      tagged.set(text, { version, text, commit });
    }
  }
  if (head === undefined) {
    return { kind: 'none', why: `the repository has no branch ${branch}` };
  }
  const atHead = [...tagged.values()].filter((each) => each.commit === head).sort((a, b) => compareVersions(b.version, a.version));
  const newest = atHead[0];
  if (newest === undefined) {
    return { kind: 'none', why: `the head of ${branch}, ${head}, carries no release tag yet; run this again once the release is tagged` };
  }
  return { kind: 'release', release: { tag: `v${newest.text}`, commit: head, version: newest.text } };
}

/** The ports a release clone takes: the git program by its absolute path, and the runner that starts it. */
export interface KitReleaseGit {
  readonly git: string;
  readonly run: ProgramRunner;
}

export type ReleaseClone = { readonly kind: 'cloned'; readonly pluginRoot: string } | { readonly kind: 'failed'; readonly why: string };

/** A run's failure text: its step, its exit and the last line it printed. */
export function runFailure(step: string, end: ShellEnd, stderr: string): string {
  const said = stderr.trim().split(/\r?\n/u).at(-1);
  const how = end.kind === 'exited' ? `exit ${end.code}` : `stopped by ${end.signal}`;
  return `${step} failed (${how})${said === undefined || said === '' ? '' : `: ${said}`}`;
}

/** Lists the channel's branch head and release tags; the listing's text, or why it could not be read. */
export async function listChannel(ports: KitReleaseGit, branch: string): Promise<{ readonly kind: 'listed'; readonly text: string } | { readonly kind: 'failed'; readonly why: string }> {
  const result = await ports.run({ program: ports.git, args: channelListingArgs(branch) });
  if (result.end.kind !== 'exited' || result.end.code !== 0) {
    return { kind: 'failed', why: runFailure(`git ls-remote ${KIT_RELEASE_REPO}`, result.end, result.stderr) };
  }
  return { kind: 'listed', text: result.stdout };
}

/**
 * Clones `release` by its tag into `folder`, one commit deep, and checks the clone's HEAD is the tag's commit, so a
 * tag moved between the listing and the clone is refused. The plugin folder it returns holds the release's dist.
 */
export async function cloneRelease(ports: KitReleaseGit, release: KitRelease, folder: string): Promise<ReleaseClone> {
  const clone = await ports.run({
    program: ports.git,
    args: ['-c', 'advice.detachedHead=false', 'clone', '-q', '--depth', '1', '--branch', release.tag, KIT_RELEASE_REPO, folder],
  });
  if (clone.end.kind !== 'exited' || clone.end.code !== 0) {
    return { kind: 'failed', why: runFailure(`git clone --branch ${release.tag}`, clone.end, clone.stderr) };
  }
  const head = await ports.run({ program: ports.git, args: ['-C', folder, 'rev-parse', 'HEAD'] });
  if (head.end.kind !== 'exited' || head.end.code !== 0) {
    return { kind: 'failed', why: runFailure('git rev-parse HEAD in the clone', head.end, head.stderr) };
  }
  const commit = head.stdout.trim();
  if (commit !== release.commit) {
    return { kind: 'failed', why: `the clone of ${release.tag} is at ${commit}, not the tag's commit ${release.commit}` };
  }
  return { kind: 'cloned', pluginRoot: join(folder, 'plugins', 'teamrig') };
}
