import { terminalPortOf } from '../composition/terminal-ports.ts';
import type { TerminalChoice } from '../config/types.ts';
import type { TerminalDeclaration } from '../plugin-api/index.ts';
import { candidatesOf, type OpenTabDeps } from './open-tab.ts';
import type { Terminal } from './terminals.ts';

/**
 * Bringing a running session's tab to the front (T1358 `meeting start`). The tab is the one titled with the session
 * (`[<team>] <name>`, sessionDisplay), which is the pane id the built-in terminals answer `open` with. Each terminal's
 * port does the focus. A terminal whose port serves no focus is named with its own `pane.focus` notice, which says why
 * (and, for headless, how to watch the session instead); one whose row claims a focus it did not serve is only named
 * among those that cannot select a tab by its title.
 */

/** What a terminal's own declaration says in place of a focus; undefined for one whose row claims it. */
function unservedNotice(declaration: TerminalDeclaration): string | undefined {
  const focus = declaration.manifest['pane.focus'];
  return focus.kind === 'unsupported' ? focus.notice : undefined;
}

/** The tab brought to the front, the tab selected behind another app's window, or none, with why. */
export type FocusOutcome =
  | { readonly kind: 'focused'; readonly terminal: Terminal }
  | { readonly kind: 'behind'; readonly terminal: Terminal }
  | { readonly kind: 'none'; readonly reasons: readonly string[] };

/** Brings the tab titled `title` to the front in the chosen terminal, or the first `auto` finds that has it. */
export async function focusTab(deps: OpenTabDeps, choice: TerminalChoice, title: string): Promise<FocusOutcome> {
  const reasons: string[] = [];
  const titleless: Terminal[] = [];
  const terminalDeps = { env: deps.env, platform: deps.platform, processes: deps.processes, cwd: deps.cwd };
  for (const terminal of candidatesOf(choice, deps)) {
    const reach = await terminalPortOf(terminal, terminalDeps, deps.importer);
    if (reach.kind === 'refused') {
      reasons.push(`${terminal}: ${reach.why}`);
      continue;
    }
    const answer = await reach.port.focus(title);
    switch (answer.kind) {
      case 'done':
        return { kind: 'focused', terminal };
      case 'selected':
        return { kind: 'behind', terminal };
      case 'gone':
        reasons.push(`${terminal} has no tab titled ${title}`);
        break;
      case 'unserved': {
        const notice = unservedNotice(reach.declaration);
        if (notice === undefined) {
          titleless.push(terminal);
        } else {
          reasons.push(`${terminal}: ${notice}`);
        }
        break;
      }
      case 'failed':
        reasons.push(`${terminal}: ${answer.why}`);
        break;
    }
  }
  if (titleless.length > 0) {
    reasons.push(`${titleless.join(', ')} cannot select a tab by its title`);
  }
  return { kind: 'none', reasons: reasons.length === 0 ? ['the terminal setting is print'] : reasons };
}
