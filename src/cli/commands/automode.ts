import { kitLines, kitTag, type AutoModeFacts } from '../../automode/lines.ts';
import type { JsonRecord } from '../../core/guards.ts';
import { homeRelative } from '../../core/paths.ts';
import { planAllowSync } from '../../permissions/allow-sync.ts';
import { readAllowRecord, sameRecord, withOwned, writeAllowRecord } from '../allow-record.ts';
import { noPositionals, type ParsedArgs } from '../args.ts';
import { checked, readUserSettings, settingsTargetOf, writeUserSettings } from '../user-settings.ts';
import { permissionsOf } from '../host.ts';
import { openTeamKit, requireConfig } from '../kit.ts';
import { EXIT, type CliRuntime, type ExitCode } from '../runtime.ts';

/**
 * `automode install` and `automode uninstall`: put the team's tagged lines into the host's trusted routes setting, the
 * facts of the setup its automatic approval reads (src/automode/lines.ts), or take them back out. Install also syncs
 * teamrig's own allow rules in the host's allow setting (src/permissions/allow-sync.ts): it adds the missing ones and
 * takes out the ones it wrote that are no longer synced, as its record in the kit's home names them
 * (src/cli/allow-record.ts), never a rule the person wrote. Uninstall leaves those rules, as every team on the machine
 * shares them. They change the person's own host settings, so they take no `--session`; the lines come from the
 * team's config and the rules from teamrig, so a config change or a teamrig upgrade is picked up by running install
 * again. Without --yes they only show the change; with it, the old settings file is kept in the kit's backups folder
 * first. A host that keeps no permission rule refuses both.
 */

/** `automode install [--yes]`. */
export async function install(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const permissions = permissionsOf(runtime);
  const facts = await factsOf(runtime);
  const plan: Planner = (settings, owned) => {
    const routes = checked(permissions.installRoutes(settings, kitTag(facts.team), kitLines(facts)));
    const allow = checked(planAllowSync(permissions, routes.settings ?? settings, owned));
    return {
      settings: allow.settings ?? routes.settings,
      changes: [
        { setting: permissions.routesSetting, removed: routes.removed, added: routes.added },
        { setting: permissions.allowSetting, removed: allow.removed, added: allow.added },
      ],
      owned: allow.owned,
    };
  };
  return apply(args, runtime, plan, `team ${facts.team}'s lines and teamrig's allow rules are already there`);
}

/** `automode uninstall [--yes]`. */
export async function uninstall(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const permissions = permissionsOf(runtime);
  const { team } = await factsOf(runtime);
  const plan: Planner = (settings) => {
    const routes = checked(permissions.uninstallRoutes(settings, kitTag(team)));
    return { settings: routes.settings, changes: [{ setting: permissions.routesSetting, removed: routes.removed, added: routes.added }], owned: undefined };
  };
  return apply(args, runtime, plan, `team ${team} has no lines there`);
}

async function factsOf(runtime: CliRuntime): Promise<AutoModeFacts> {
  const kit = await openTeamKit(runtime);
  const config = requireConfig(kit, runtime, 'read');
  return {
    team: kit.paths.team,
    home: homeRelative(kit.paths.home, runtime.userHome),
    lead: config.roles.lead,
    pushGuard: config.pushGuard,
  };
}

/** What a change does to one setting, named as the host names it (`HostPermissions.routesSetting`, `allowSetting`). */
interface SettingChange {
  readonly setting: string;
  readonly removed: readonly string[];
  readonly added: readonly string[];
}

/** The settings to write, undefined when nothing changes, what that does to each setting, and the rules it owns after. */
interface SettingsPlan {
  readonly settings: JsonRecord | undefined;
  readonly changes: readonly SettingChange[];
  /** The allow rules the sync owns in the file once written; undefined when the change syncs none. */
  readonly owned: readonly string[] | undefined;
}

/** The change to the settings read now, given the rules the record says a sync wrote there; a problem is refused. */
type Planner = (settings: JsonRecord, owned: readonly string[]) => SettingsPlan;

/** One line per rule or route a change takes out, then per one it puts in, each naming its setting. */
function stepsOf(path: string, changes: readonly SettingChange[]): string[] {
  const where = (change: SettingChange): string => `${path} ${change.setting}`;
  return [
    ...changes.flatMap((change) => change.removed.map((item) => `  REMOVE ${where(change)}: ${item}`)),
    ...changes.flatMap((change) => change.added.map((item) => `  ADD ${where(change)}: ${item}`)),
  ];
}

/**
 * Reads the settings and the record, plans, and with --yes writes. The record is written twice around the settings:
 * first naming every rule the write may leave there (owned and added), then naming only what is left, so a write
 * stopped between the two never leaves a synced rule the record does not name, which would read as the person's own.
 */
async function apply(args: ParsedArgs, runtime: CliRuntime, plan: Planner, unchanged: string): Promise<ExitCode> {
  const target = settingsTargetOf(runtime);
  const settings = await readUserSettings(runtime, target.settingsPath);
  const record = await readAllowRecord(runtime.files, target.allowRecordPath);
  const owned = record.get(target.settingsPath) ?? [];
  const { settings: next, changes, owned: after } = plan(settings.json, owned);
  const recordAfter = after === undefined ? record : withOwned(record, target.settingsPath, after);
  const yes = args.switches.has('yes');
  if (next === undefined) {
    if (yes && !sameRecord(record, recordAfter)) {
      await writeAllowRecord(runtime.files, target.allowRecordPath, recordAfter);
    }
    runtime.out.stdout(`UNCHANGED ${target.settingsPath}: ${unchanged}`);
    return EXIT.ok;
  }
  const steps = stepsOf(target.settingsPath, changes);
  if (!yes) {
    runtime.out.stdout('PREVIEW nothing written (add --yes to write)');
    steps.forEach((line) => runtime.out.stdout(line));
    return EXIT.ok;
  }
  const during = after === undefined ? record : withOwned(record, target.settingsPath, [...owned, ...after]);
  if (!sameRecord(record, during)) {
    await writeAllowRecord(runtime.files, target.allowRecordPath, during);
  }
  const backup = await writeUserSettings(runtime, target, settings, next);
  if (!sameRecord(during, recordAfter)) {
    await writeAllowRecord(runtime.files, target.allowRecordPath, recordAfter);
  }
  runtime.out.stdout(`WROTE the changes below${backup === undefined ? '' : `; the old settings file is at ${backup}`}`);
  steps.forEach((line) => runtime.out.stdout(line));
  return EXIT.ok;
}
