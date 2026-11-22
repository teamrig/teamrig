/**
 * Who holds a session's tab title: `hooks` when the host leaves it to them (its title switch is on, or it writes no
 * title of its own); `host` when it writes its own over the circle until the person sets the switch it names;
 * `no-hooks` when the host calls no hook, so nothing writes the circle.
 */
export type TitleHold =
  | { readonly kind: 'hooks' }
  | { readonly kind: 'host'; readonly hostName: string; readonly variable: string; readonly value: string }
  | { readonly kind: 'no-hooks' };

/**
 * What `team create` says about tab status, a colored circle before each tab's title for what its session is
 * doing (hook-tab-status.ts). The circle shows only when the team's config turns it on, which a new team's
 * does, and the host leaves the tab title to hooks. A host's switch for that sits in its own settings and
 * may also take the title from tabs of projects outside teamrig, so teamrig names it and never writes it.
 */
export interface TabStatusFacts {
  readonly team: string;
  /** Whether the team's config, new or kept, has `tabStatus.enabled`. */
  readonly configOn: boolean;
  readonly configPath: string;
  readonly title: TitleHold;
  /** The settings file of the host whose `env` takes the switch; none where teamrig does not know the host's folders. */
  readonly settingsPath: string | undefined;
}

/** What the person does so the host leaves the title to hooks; none when it already does. */
function titleStep(title: TitleHold, settingsPath: string | undefined): string | undefined {
  switch (title.kind) {
    case 'hooks':
      return undefined;
    case 'no-hooks':
      return "run the team's sessions on a host that calls teamrig's hooks, which write the circle";
    case 'host':
      // With no settings file known, the note names the switch alone: a file teamrig only guessed would send the user to the wrong place.
      return settingsPath === undefined
        ? `set ${title.variable}=${title.value} in the environment the team's sessions start in and restart them, so the host stops writing its own title over the circle`
        : `add "${title.variable}": "${title.value}" to "env" in ${settingsPath} and restart ${title.hostName}, so it stops writing its own title over the circle (tabs of projects outside teamrig then keep the terminal's title)`;
  }
}

/** One line: tab status on, or what the user does to see it. */
export function tabStatusLine(facts: TabStatusFacts): string {
  const step = titleStep(facts.title, facts.settingsPath);
  const missing = [...(facts.configOn ? [] : [`set "tabStatus": { "enabled": true } in ${facts.configPath}`]), ...(step === undefined ? [] : [step])];
  if (missing.length === 0) {
    return `TAB STATUS on: each tab of team ${facts.team} shows a colored circle before its title for what its session is doing: green ready, yellow working, orange waiting on you`;
  }
  return `NOTE each tab of team ${facts.team} shows a colored circle before its title for what its session is doing once you ${missing.join(', and ')}`;
}
