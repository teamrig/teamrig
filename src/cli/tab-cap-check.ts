import { KIT_NAME } from '../core/home.ts';
import type { TabCapExcess } from './tab-cap.ts';
import type { UnownedWarning } from './unowned.ts';

/** The text of an OVER-CAP warning: the team's tabs, its cap, and the sessions to close in order, each by name. */
export function tabCapWarningText(team: string, excess: TabCapExcess, nameOf: (id: string) => string): string {
  const head = `OVER-CAP team ${team} has ${excess.open} tabs open, over its cap of ${excess.maxTabs} (open.headroom.maxTabs)`;
  if (excess.toClose.length === 0) {
    return `${head}: every session open is one ${KIT_NAME} close never closes, so close a tab by hand or raise the cap`;
  }
  const names = excess.toClose.map((each) => nameOf(each.id));
  return `${head}: close ${names.join(', ')} in that order, lowest-ranked work first, each with ${KIT_NAME} close <name> --yes`;
}

/**
 * OVER-CAP (T5479), for `check`: a team past `open.headroom.maxTabs` has more tabs than its user allows, and no one
 * session owns the whole team's tab count, so it goes to the lead, naming the sessions `teamrig close` would close
 * first. With no cap set it reads nothing (`excessOf` lists the host's processes). Its key names the team, so the
 * lead is told once while it stands, however many tabs it is over.
 */
export async function tabCapWarnings(
  team: string,
  maxTabs: number | undefined,
  excessOf: () => Promise<TabCapExcess | undefined>,
  nameOf: (id: string) => string,
): Promise<UnownedWarning[]> {
  if (maxTabs === undefined) {
    return [];
  }
  const excess = await excessOf();
  if (excess === undefined) {
    return [];
  }
  return [{ key: `over-cap ${team}`, source: `the tab cap check of team ${team}`, text: tabCapWarningText(team, excess, nameOf) }];
}
