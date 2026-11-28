import type { KitConfig } from '../../config/types.ts';
import { clientRootOf } from '../../exec/client-integrity.ts';
import { ClientInstalls, ShellPathSearch } from '../../exec/client-launch.ts';
import { gitContextOf } from '../../permissions/route-context.ts';
import { ownClientOf, type KitContext } from '../../permissions/route-kit.ts';
import type { LandingContext } from '../../permissions/route-pr.ts';
import { shellRouteOf, type RouteContext, type SanctionedRoute } from '../../permissions/sanctioned.ts';
import type { HookEvent } from '../../ports/host/index.ts';
import { JsonlEventLog } from '../../register/store.ts';
import type { CommandTable } from '../../slash/plan.ts';
import { rosterOf, type Kit } from '../kit.ts';
import type { CliRuntime } from '../runtime.ts';
import { approversOf } from '../ship-approval.ts';
import { tabSessionOf } from '../tab-session.ts';
import { teamSessionOf } from './hook-input.ts';

/** The folder a tool call runs in: the event's, else the hook's own (the host may start the hook elsewhere). */
function callCwdOf(runtime: CliRuntime, event: HookEvent): string {
  return event.cwd ?? runtime.cwd;
}

/**
 * What a hook reads a teamrig line with: the CLI's table, and whether the program word is this install's own launcher,
 * placed as a bash call's shell would place it from the call's folder, the event's first (the host may start the hook
 * elsewhere).
 */
export function kitContextOf(runtime: CliRuntime, event: HookEvent, cli: CommandTable): KitContext {
  const cwd = callCwdOf(runtime, event);
  const search = new ShellPathSearch({ env: runtime.env, platform: runtime.platform, probe: runtime.probe });
  const installs = new ClientInstalls(clientRootOf(runtime.self.script), runtime.platform);
  return { cli, ownClient: ownClientOf(search, installs, { dialect: 'bash', dir: cwd, home: runtime.userHome }) };
}

/**
 * Who clears a pull request landing by the session `named` (else the session `$TEAMRIG_SESSION` names) on this team
 * (T5070, security verdict T5072 C1): its leaders, as `teamrig pr` reads them, when the call's tab is bound to that
 * session alone (`tabSessionOf`); none for a tab bound elsewhere or to nobody, a root team's lead, or a failed read.
 */
function landingApproversOf(runtime: CliRuntime, kit: Kit, config: KitConfig, event: HookEvent): LandingContext['approversOf'] {
  return async (named) => {
    const hostSession = event.session;
    if (hostSession === undefined) {
      return [];
    }
    const roster = await rosterOf(runtime, kit, config);
    const bound = await tabSessionOf(runtime.files, kit.paths.inboxMarks, roster, hostSession, named ?? runtime.env['TEAMRIG_SESSION']);
    return bound === undefined ? [] : approversOf(runtime, kit.paths.team, config, bound).catch(() => []);
  };
}

/**
 * A hook's sanctioned-route lookup (T679): the context `routeOf` needs, read from the hook's runtime and event; the
 * tab's session and the register are read only when a push or landing line asks.
 */
export function routeContextOf(runtime: CliRuntime, kit: Kit, config: KitConfig, event: HookEvent, cli: CommandTable): RouteContext {
  const cwd = callCwdOf(runtime, event);
  return {
    ...kitContextOf(runtime, event, cli),
    approversOf: landingApproversOf(runtime, kit, config, event),
    ...gitContextOf({
      cwd,
      home: runtime.userHome,
      git: runtime.git,
      caller: async () => teamSessionOf(runtime, kit, await rosterOf(runtime, kit, config), event.session ?? null),
      ownerOf: async (task) => (await new JsonlEventLog(runtime.files, kit.paths.events).read()).state.tasks.get(task)?.owner,
      protectedBranches: config.pushGuard.protectedBranches,
      branches: config.delivery.branches,
      hasRef: (dir, ref) => runtime.mergeGit.sha(dir, ref) !== undefined,
    }),
  };
}

/**
 * The route a bash call's line runs, in every text bash may run (`shellRouteOf`); undefined for any other call, a line
 * that is none, or a lookup that fails.
 */
export async function callRouteOf(runtime: CliRuntime, kit: Kit, config: KitConfig, event: HookEvent, cli: CommandTable): Promise<SanctionedRoute | undefined> {
  const { call } = event;
  if (call?.kind !== 'shell' || call.dialect !== 'bash' || call.command === undefined) {
    return undefined;
  }
  return shellRouteOf(call, routeContextOf(runtime, kit, config, event, cli)).catch(() => undefined);
}
