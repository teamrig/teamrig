import { readFileSync } from 'node:fs';
import type { Git } from '../lib/git.ts';
import { isRecord } from '../lib/guards.ts';
import { stableStart, type Channels } from './channels.ts';

/**
 * Moves the stable channel (T5133). Stable installs read the `release` branch, which only moves along the `preview`
 * branch's chain of published releases (tools/release/publish.ts), so a promotion is a fast-forward of `release` to a
 * preview release's own commit: the same tag and build preview users ran, never a new build.
 * - Scheduled: picks the newest `v*` preview release published at least `soakHours` before stable's last `stableAt`,
 *   skipping each version tools/release/release-hold.json lists. Every run from one `stableAt` to the next picks the
 *   same release, so an hourly run moves stable once a day and a late run catches up.
 * - Hotfix: promotes the named preview tag at once, with no soak, only when it still names the commit the lead approved.
 * Both refuse anything but a fast-forward and a held version, and push without force, so the remote refuses a move
 * that raced another.
 */

export interface PreviewRelease {
  /** The tag, `v<MAJOR.MINOR.PATCH>`. */
  readonly tag: string;
  /** The release commit the tag names. */
  readonly sha: string;
  /** When publish.ts made the release commit. */
  readonly published: Date;
}

/** A hotfix promotion: the preview tag the lead approved, and the commit it named then. */
export interface Hotfix {
  readonly tag: string;
  readonly sha: string;
}

export interface Promotion {
  readonly remote: string;
  readonly channels: Channels;
  /** Each held tag with why it is held. */
  readonly held: ReadonlyMap<string, string>;
  readonly now: Date;
  /** The tag to promote at once, or undefined for the scheduled pick. */
  readonly hotfix: Hotfix | undefined;
  /** Says what it would push, and pushes nothing. */
  readonly dryRun: boolean;
}

export type PromoteResult = { readonly moved: true; readonly tag: string; readonly sha: string } | { readonly moved: false; readonly reason: string };

const STABLE = 'release';
const PREVIEW = 'preview';
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const SHA = /^[0-9a-f]{40}$/;
const HOUR_MS = 3_600_000;

export const HOLD_PATH = new URL('./release-hold.json', import.meta.url);

/** The held tags from release-hold.json's text (`{ "v1.2.3": "why" }`); throws on any other shape, so a run fails closed. */
export function parseHold(text: string): ReadonlyMap<string, string> {
  const body: unknown = JSON.parse(text);
  if (!isRecord(body)) throw new Error('release-hold.json: expected { "v<MAJOR.MINOR.PATCH>": "why it is held" }');
  const held = new Map<string, string>();
  for (const [tag, why] of Object.entries(body)) {
    if (!TAG.test(tag)) throw new Error(`release-hold.json: ${tag} is not a v<MAJOR.MINOR.PATCH> tag`);
    if (typeof why !== 'string' || why.trim() === '') throw new Error(`release-hold.json: ${tag} says no reason`);
    held.set(tag, why);
  }
  return held;
}

export function readHold(path: URL = HOLD_PATH): ReadonlyMap<string, string> {
  return parseHold(readFileSync(path, 'utf8'));
}

/** The tag's MAJOR, MINOR and PATCH, or undefined for a tag of another shape. */
function versionOf(tag: string): readonly [number, number, number] | undefined {
  const match = TAG.exec(tag);
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Below zero when `a` is the older version, above zero when it is the newer one. */
export function compareTags(a: string, b: string): number {
  const [left, right] = [versionOf(a) ?? [0, 0, 0], versionOf(b) ?? [0, 0, 0]];
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

/** The sha a branch has on the remote, fetched here, or undefined when the remote has no such branch. */
async function fetchBranch(git: Git, remote: string, branch: string): Promise<string | undefined> {
  const ref = `refs/heads/${branch}`;
  const line = (await git.text(['ls-remote', remote, ref])).split('\n').find((row) => row.endsWith(`\t${ref}`));
  const sha = line?.split('\t')[0];
  if (sha === undefined) return undefined;
  await git.text(['fetch', '--quiet', '--no-tags', remote, ref]);
  return sha;
}

/** Each `v*` release tag on `head`'s chain, read after fetching the remote's tags; a tag of another shape is left out. */
export async function previewReleases(git: Git, remote: string, head: string): Promise<readonly PreviewRelease[]> {
  await git.text(['fetch', '--quiet', remote, '+refs/tags/v*:refs/tags/v*']);
  const format = '%(refname:strip=2)%09%(objectname)%09%(*objectname)%09%(committerdate:unix)%09%(*committerdate:unix)';
  const rows = (await git.text(['for-each-ref', `--merged=${head}`, `--format=${format}`, 'refs/tags/v*'])).split('\n').filter((row) => row !== '');
  return rows.flatMap((row) => {
    const [tag = '', object = '', peeled = '', date = '', peeledDate = ''] = row.split('\t');
    // An annotated tag names its tag object; the commit and its date are the peeled ones.
    const sha = peeled === '' ? object : peeled;
    const seconds = Number(peeled === '' ? date : peeledDate);
    if (versionOf(tag) === undefined || !SHA.test(sha) || !Number.isFinite(seconds)) return [];
    return [{ tag, sha, published: new Date(seconds * 1000) }];
  });
}

async function isAncestor(git: Git, older: string, newer: string): Promise<boolean> {
  try {
    await git.text(['merge-base', '--is-ancestor', older, newer]);
    return true;
  } catch {
    return false;
  }
}

/** The scheduled pick: the newest release that soaked by stable's last move, is not held and moves stable forward. */
export async function scheduledPick(git: Git, releases: readonly PreviewRelease[], stable: string, promotion: Promotion): Promise<PreviewRelease | string> {
  const cutoff = stableStart(promotion.now, promotion.channels).getTime() - promotion.channels.soakHours * HOUR_MS;
  const ready = releases.filter((release) => release.published.getTime() <= cutoff && !promotion.held.has(release.tag)).sort((a, b) => compareTags(b.tag, a.tag));
  const [newest] = ready;
  if (newest === undefined) return `no preview release soaked ${promotion.channels.soakHours} h by ${new Date(cutoff + promotion.channels.soakHours * HOUR_MS).toISOString()}`;
  if (newest.sha === stable) return `stable already holds ${newest.tag}`;
  if (!(await isAncestor(git, stable, newest.sha))) return `stable's ${stable} is not behind ${newest.tag} on the ${PREVIEW} chain`;
  return newest;
}

/** The hotfix pick: the named tag, refused unless it names the approved commit on preview's chain past stable. */
async function hotfixPick(git: Git, releases: readonly PreviewRelease[], stable: string, hotfix: Hotfix, held: ReadonlyMap<string, string>): Promise<PreviewRelease> {
  if (!TAG.test(hotfix.tag)) throw new Error(`the hotfix tag ${hotfix.tag} is not v<MAJOR.MINOR.PATCH>`);
  if (!SHA.test(hotfix.sha)) throw new Error(`the hotfix sha ${hotfix.sha} is not a full commit sha`);
  const why = held.get(hotfix.tag);
  if (why !== undefined) throw new Error(`${hotfix.tag} is held: ${why}`);
  const release = releases.find((one) => one.tag === hotfix.tag);
  if (release === undefined) throw new Error(`${hotfix.tag} is not a release on the ${PREVIEW} branch`);
  if (release.sha !== hotfix.sha) throw new Error(`${hotfix.tag} names ${release.sha}, not the approved ${hotfix.sha}`);
  if (release.sha === stable) throw new Error(`stable already holds ${hotfix.tag}`);
  if (!(await isAncestor(git, stable, release.sha))) throw new Error(`${hotfix.tag} does not move stable's ${stable} forward`);
  return release;
}

/** Promotes a preview release to stable, or says why nothing moved; throws on a refused hotfix or a failed push. */
export async function promote(git: Git, promotion: Promotion, log: (line: string) => void): Promise<PromoteResult> {
  const { remote, hotfix, dryRun } = promotion;
  const [preview, stable] = [await fetchBranch(git, remote, PREVIEW), await fetchBranch(git, remote, STABLE)];
  if (preview === undefined || stable === undefined) {
    if (hotfix !== undefined) throw new Error(`the remote has no ${preview === undefined ? PREVIEW : STABLE} branch`);
    const reason = `the remote has no ${preview === undefined ? PREVIEW : STABLE} branch yet`;
    log(`promote: ${reason}; nothing to do`);
    return { moved: false, reason };
  }
  const releases = await previewReleases(git, remote, preview);
  const pick = hotfix === undefined ? await scheduledPick(git, releases, stable, promotion) : await hotfixPick(git, releases, stable, hotfix, promotion.held);
  if (typeof pick === 'string') {
    log(`promote: ${pick}; nothing to do`);
    return { moved: false, reason: pick };
  }
  if (dryRun) {
    log(`promote: would move ${STABLE} from ${stable} to ${pick.tag} (${pick.sha}); dry run, nothing pushed`);
    return { moved: false, reason: 'dry run' };
  }
  await git.text(['push', remote, `${pick.sha}:refs/heads/${STABLE}`]);
  log(`promote: moved ${STABLE} from ${stable} to ${pick.tag} (${pick.sha})${hotfix === undefined ? '' : ', a hotfix'}`);
  return { moved: true, tag: pick.tag, sha: pick.sha };
}
