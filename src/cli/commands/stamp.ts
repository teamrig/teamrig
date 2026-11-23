import { basename, join, resolve } from 'node:path';
import { defaultSnapshotDir, parseSnapshot, snapshotDirOf } from '../../budget/snapshot.ts';
import { resolveKitHome } from '../../core/home.ts';
import { madeByTrailer, stampTrailer, withStampTrailers, type StampMaker } from '../../core/stamp.ts';
import { isUnsupported } from '../../ports/host/index.ts';
import { onePositional, type ParsedArgs } from '../args.ts';
import { hostOf } from '../host.ts';
import { EXIT, type CliRuntime, type ExitCode } from '../runtime.ts';
import { guardLoadOf } from './hook-guard-load.ts';

/** The team's stamp setting and status snapshot folder, as the guards find the team; outside one, on and the kit's folder. */
async function stampSetupOf(runtime: CliRuntime): Promise<{ readonly enabled: boolean; readonly snapshotDir: string }> {
  const kit = (await guardLoadOf(undefined, runtime))?.kit;
  if (kit === undefined || kit.load.status !== 'loaded') {
    return { enabled: true, snapshotDir: defaultSnapshotDir(resolveKitHome(runtime.env, runtime.userHome)) };
  }
  const { config } = kit.load;
  return { enabled: config.commits.stamp, snapshotDir: snapshotDirOf(config.budget, kit.paths) };
}

/**
 * The session that runs this commit, from the host's launcher and the session's last status snapshot; undefined on a
 * host with no launcher, or outside any session of it (a person's own commit names no maker). An effort the host
 * forces on every session beats the one the snapshot read.
 */
async function makerOf(runtime: CliRuntime, snapshotDir: string): Promise<StampMaker | undefined> {
  const { launcher } = hostOf(runtime);
  if (isUnsupported(launcher)) {
    return undefined;
  }
  const identity = launcher.identity();
  if (identity.sessionId === undefined) {
    return undefined;
  }
  // The id names a file in the snapshot folder; one that would leave it reads no snapshot.
  const fileName = `${identity.sessionId}.json`;
  const text = basename(fileName) === fileName ? await runtime.files.read(join(snapshotDir, fileName)) : undefined;
  const snapshot = text === undefined ? undefined : parseSnapshot(text);
  return {
    program: launcher.programName,
    version: snapshot?.hostVersion ?? undefined,
    model: snapshot?.model ?? undefined,
    effort: identity.forcedEffort ?? snapshot?.effort ?? undefined,
  };
}

/**
 * `stamp commit <file>`: the commit message file with teamrig's stamp trailers, for a git commit-msg hook (T4869):
 * `Made-with: teamrig <version>`, and `Made-by` naming the program, model and effort of the session making the commit.
 * `commits.stamp: false` leaves the file as written. The hook line ends `|| true`, so a failure here never blocks a
 * commit.
 */
export async function commit(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  const path = resolve(runtime.cwd, onePositional(args, 'file'));
  const text = await runtime.files.read(path);
  if (text === undefined) {
    throw new Error(`no commit message file at ${path}`);
  }
  const setup = await stampSetupOf(runtime);
  if (!setup.enabled) {
    runtime.out.stdout('SKIPPED commits.stamp is false: the message is left as written');
    return EXIT.ok;
  }
  const maker = await makerOf(runtime, setup.snapshotDir);
  const stamped = withStampTrailers(text, maker);
  if (stamped !== text) {
    await runtime.files.write(path, stamped);
  }
  runtime.out.stdout(`STAMPED ${maker === undefined ? stampTrailer() : `${stampTrailer()}, ${madeByTrailer(maker)}`}`);
  return EXIT.ok;
}
