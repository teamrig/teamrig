import { dirname } from 'node:path';
import { resolveKitHome } from '../../core/home.ts';
import { WRITE_SWITCH } from '../../core/settings-writers.ts';
import { KIT_VERSION } from '../../core/version.ts';
import { clientRootOf } from '../../exec/client-integrity.ts';
import { kitVersionsFolder, readKitCurrent } from '../../kit/kit-versions.ts';
import { claimOldKitSweep, endOldKitTargets, oldKitEndLine, oldKitTargetText, planOldKitSweep, type OldKitSweepPorts } from '../../kit/old-kit-sweep.ts';
import { restoreLogPath } from '../../restore/registry.ts';
import { noPositionals, type ParsedArgs } from '../args.ts';
import { EXIT, type CliRuntime, type ExitCode } from '../runtime.ts';

/**
 * `teamrig kit sweep [--yes]`: ends what an older teamrig version left running after an update (T5813), its task pane
 * watchers and UIs, each with every process it started (src/kit/old-kit-sweep.ts). Only the version the kit home
 * names current sweeps. Without `--yes` it names them and ends nothing; with it, each end goes to the restore log.
 */

type KitSweepRuntime = Pick<CliRuntime, 'env' | 'userHome' | 'files' | 'out' | 'platform' | 'pid' | 'self' | 'sessionProcesses' | 'clock'>;

/** The folders a version runs from: the kit home's `versions/`, and the one holding this client (a host's plugin cache). */
function sweepPortsOf(runtime: KitSweepRuntime, kitHome: string): OldKitSweepPorts {
  return {
    files: runtime.files,
    kitHome,
    running: KIT_VERSION,
    roots: [kitVersionsFolder(kitHome), dirname(clientRootOf(runtime.self.script))],
    platform: runtime.platform,
    ownPid: runtime.pid,
    processes: runtime.sessionProcesses,
  };
}

/**
 * Starts `kit sweep --yes` hidden, never waiting on it, when this teamrig is the version the kit home names current
 * and either `installed` (this start just made it current) or no sweep started in the last 10 minutes
 * (`claimOldKitSweep`). An older version's hooks start none and take no claim, so they never hold back the current
 * one's. Whether one started.
 */
export async function startOldKitSweep(
  runtime: Pick<CliRuntime, 'files' | 'clock' | 'processes' | 'self' | 'env'>,
  kitHome: string,
  installed: boolean,
): Promise<boolean> {
  if ((await readKitCurrent(runtime.files, kitHome))?.version !== KIT_VERSION) {
    return false;
  }
  const claimed = await claimOldKitSweep(runtime.files, kitHome, runtime.clock.now());
  if (!claimed && !installed) {
    return false;
  }
  const started = await runtime.processes.startHidden({
    command: runtime.self.node,
    args: [runtime.self.script, 'kit', 'sweep', `--${WRITE_SWITCH}`],
    cwd: kitHome,
    env: runtime.env,
  });
  return started.kind === 'started';
}

export async function kitSweep(args: ParsedArgs, runtime: KitSweepRuntime): Promise<ExitCode> {
  noPositionals(args);
  const kitHome = resolveKitHome(runtime.env, runtime.userHome);
  const ports = sweepPortsOf(runtime, kitHome);
  const plan = await planOldKitSweep(ports);
  if (plan.kind === 'not-current') {
    const current = plan.current === undefined ? 'no version is current' : `current is ${plan.current}`;
    runtime.out.stdout(`NOTE nothing ended: this teamrig is ${KIT_VERSION} and ${current}; only the current version ends an older one's`);
    return EXIT.ok;
  }
  if (plan.kind === 'unlisted') {
    runtime.out.stdout('FAILED nothing ended: the system would not list its processes');
    return EXIT.failed;
  }
  if (!args.switches.has(WRITE_SWITCH)) {
    runtime.out.stdout(`PREVIEW nothing ended (add --${WRITE_SWITCH} to end them): ${plan.targets.length} left by an older version`);
    plan.targets.forEach((target) => runtime.out.stdout(`PREVIEW end ${oldKitTargetText(target)}`));
    return EXIT.ok;
  }
  if (plan.targets.length === 0) {
    runtime.out.stdout('UNCHANGED no older version runs a watcher or ui');
    return EXIT.ok;
  }
  const ends = await endOldKitTargets(ports, plan.targets);
  const at = new Date(runtime.clock.now()).toISOString();
  for (const end of ends) {
    await runtime.files.append(restoreLogPath(kitHome), `${at} ${oldKitEndLine(end)}\n`);
    const text = oldKitTargetText(end.target);
    runtime.out.stdout(end.failed === undefined ? `ENDED ${text}` : `FAILED could not end ${text}: ${end.failed}`);
  }
  return ends.some((end) => end.failed !== undefined) ? EXIT.failed : EXIT.ok;
}
