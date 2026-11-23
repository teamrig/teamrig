import { KIT_NAME } from '../../core/home.ts';
import { WRITE_SWITCH } from '../../core/settings-writers.ts';
import { pendingSteps, stepSourceOf, STEP_SOURCES, type PendingStep } from '../../steps/pending.ts';
import { noPositionals, UsageError, type ParsedArgs } from '../args.ts';
import { writeConfigMigration } from '../config-migration.ts';
import { refusedBackupLine, stepBackupLedgerOf } from '../step-backup-sweep.ts';
import { openTeamKit, requireConfig, type Kit } from '../kit.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';

/** What taking a step did: nothing, as it was no longer pending, or its change and the backup taken first. */
export type StepRun = { readonly status: 'unchanged' } | { readonly status: 'done'; readonly backup: string; readonly changes: readonly string[] };

/** How each kind of step is taken, by its id; every source in STEP_SOURCES has one. */
export const STEP_RUNS: ReadonlyMap<string, (runtime: CliRuntime, kit: Kit) => Promise<StepRun>> = new Map([
  [
    'config-format',
    async (runtime: CliRuntime, kit: Kit): Promise<StepRun> => {
      const written = await writeConfigMigration(runtime, kit, requireConfig(kit, runtime, 'read'));
      return written.status === 'unchanged' ? written : { status: 'done', backup: written.backup, changes: written.pending.changes };
    },
  ],
]);

/** `steps`: the one-time steps teamrig needs its person to take, each with what it changes and what to type. */
export async function list(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const kit = await openTeamKit(runtime);
  const steps = pendingSteps({ config: kit.load });
  if (steps.length === 0) {
    runtime.out.stdout(`NONE ${KIT_NAME} needs no step from you`);
    return EXIT.ok;
  }
  steps.forEach((step) => printStep(runtime, step));
  return EXIT.ok;
}

/**
 * `steps run <id> [--yes]`: without --yes, what the step changes and where its backup goes; with it, the step taken
 * after a backup, which stays until the step's next run replaces it or `start` removes it past `steps.backupDays`
 * (src/cli/step-backup-sweep.ts), whichever comes first. A settings writer: the person runs it, never an agent.
 */
export async function run(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  const [id, extra] = args.positionals;
  if (id === undefined) {
    throw new UsageError(`steps run needs a step: ${STEP_SOURCES.map((source) => source.id).join(', ')}`);
  }
  if (extra !== undefined) {
    throw new UsageError(`unexpected "${extra}"`);
  }
  const source = stepSourceOf(id);
  const take = STEP_RUNS.get(id);
  if (source === undefined || take === undefined) {
    throw new RefusedError(`no step ${id}; ${KIT_NAME} steps lists those pending`);
  }
  const kit = await openTeamKit(runtime);
  const step = source.pendingOf({ config: kit.load });
  if (step === undefined) {
    runtime.out.stdout(`UNCHANGED ${id} is not needed now`);
    return EXIT.ok;
  }
  if (!args.switches.has(WRITE_SWITCH)) {
    runtime.out.stdout(`PREVIEW ${step.title}; nothing changed`);
    step.preview.forEach((line) => runtime.out.stdout(`  ${line}`));
    const days = requireConfig(kit, runtime, 'read').steps.backupDays;
    runtime.out.stdout(
      `NOTE a backup goes to ${kit.paths.backups} first and stays until this step runs again or ${KIT_NAME} start removes it after ${days} days [steps.backupDays]. Take it: ${step.command}`,
    );
    return EXIT.ok;
  }
  const done = await take(runtime, kit);
  if (done.status === 'unchanged') {
    runtime.out.stdout(`UNCHANGED ${id} is not needed now`);
    return EXIT.ok;
  }
  const config = requireConfig(kit, runtime, 'read');
  const { removed, refused } = await stepBackupLedgerOf(runtime, kit, config).replace({ step: id, path: done.backup, at: new Date(runtime.clock.now()).toISOString() });
  runtime.out.stdout(`DONE ${step.title}; the backup is at ${done.backup}`);
  done.changes.forEach((line) => runtime.out.stdout(`  ${line}`));
  removed.forEach((path) => runtime.out.stdout(`REMOVED the earlier backup ${path}`));
  refused.forEach((path) => runtime.out.stdout(`NOTE ${refusedBackupLine(path)}`));
  return EXIT.ok;
}

function printStep(runtime: CliRuntime, step: PendingStep): void {
  runtime.out.stdout(`STEP ${step.id}: ${step.title}`);
  runtime.out.stdout(`  why: ${step.why}`);
  step.preview.forEach((line) => runtime.out.stdout(`  ${line}`));
  runtime.out.stdout(`  take it: ${step.command}`);
}
