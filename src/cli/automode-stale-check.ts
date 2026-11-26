import { autoModeFactsOf, kitLines, kitTag } from '../automode/lines.ts';
import type { KitConfig } from '../config/types.ts';
import type { TeamPaths } from '../core/home.ts';
import { homeRelative } from '../core/paths.ts';
import { jsonObjectOf } from '../doctor/settings-env.ts';
import { pathsIfKnown, permissionsIfKept } from './host.ts';
import type { CliRuntime } from './runtime.ts';
import type { UnownedWarning } from './unowned.ts';

/**
 * AUTOMODE-STALE (T5338), for `check`: the team's tagged lines in the host's trusted routes setting differ from what
 * `automode install` would write now, from the team's config and this teamrig. The lines are filled at install time
 * (the repositories, the lead, the push guard), so a config change such as an organization move, or an upgrade that
 * adds a line, leaves auto mode reading the team as it was until install runs again; this check makes that drift a
 * flag at once instead of a classifier refusal later. A machine with none of the team's lines is not flagged: the
 * team never installed them, which is the person's choice. Writing them changes the person's permission settings, the
 * owner's gate, so the warning is no session's and goes to the lead. Reads only; a host whose settings teamrig does
 * not know, or a settings file it cannot read, raises nothing.
 */
export async function autoModeStaleWarnings(runtime: CliRuntime, paths: Pick<TeamPaths, 'team' | 'home'>, config: KitConfig): Promise<UnownedWarning[]> {
  const host = pathsIfKnown(runtime);
  const permissions = permissionsIfKept(runtime);
  if (host === undefined || permissions === undefined) {
    return [];
  }
  const path = host.userSettings(runtime.userHome);
  const text = await runtime.files.read(path);
  const settings = text === undefined ? undefined : jsonObjectOf(text);
  if (settings === undefined) {
    return [];
  }
  const installed = permissions.uninstallRoutes(settings, kitTag(paths.team));
  if (!installed.ok || installed.value.removed.length === 0) {
    return [];
  }
  const was = installed.value.removed;
  const now = kitLines(autoModeFactsOf(paths.team, homeRelative(paths.home, runtime.userHome), config));
  const changed = now.filter((line) => !was.includes(line)).length;
  const dropped = was.filter((line) => !now.includes(line)).length;
  if (changed === 0 && dropped === 0) {
    return [];
  }
  const counts = `${String(changed)} of its ${String(now.length)} lines missing or out of date${dropped === 0 ? '' : `, ${String(dropped)} no longer written`}`;
  return [
    {
      key: `automode-stale ${paths.team}`,
      source: `the auto mode lines check [${permissions.routesSetting}]`,
      text:
        `AUTOMODE-STALE ${path} ${permissions.routesSetting} holds team ${paths.team}'s lines as an older config or teamrig wrote them (${counts}), ` +
        "so auto mode reads the team as it was. `teamrig automode install` shows the change; writing it with --yes changes the person's permission settings, the owner's call.",
    },
  ];
}
