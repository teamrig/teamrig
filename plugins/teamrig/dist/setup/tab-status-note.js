/** What the person does so the host leaves the title to hooks; none when it already does. */
function titleStep(title, settingsPath) {
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
export function tabStatusLine(facts) {
    const step = titleStep(facts.title, facts.settingsPath);
    const missing = [...(facts.configOn ? [] : [`set "tabStatus": { "enabled": true } in ${facts.configPath}`]), ...(step === undefined ? [] : [step])];
    if (missing.length === 0) {
        return `TAB STATUS on: each tab of team ${facts.team} shows a colored circle before its title for what its session is doing: green ready, yellow working, orange waiting on you`;
    }
    return `NOTE each tab of team ${facts.team} shows a colored circle before its title for what its session is doing once you ${missing.join(', and ')}`;
}
