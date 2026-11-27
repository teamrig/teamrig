/** The window of a team's own its tabs open in when `open.teamWindow` is on, apart from other teams' tabs (T1427). */
export function teamWindowOf(teamWindow, team) {
    return teamWindow ? `teamrig-${team}` : undefined;
}
/**
 * The terminal this run works in, found by the variables each sets in its panes, when it is one that can split:
 * tmux first, as it may run inside Windows Terminal and its pane is the nearer one. Other terminals have no split a
 * launcher can ask for.
 */
export function splittableTerminal(env) {
    if ((env['TMUX'] ?? '') !== '') {
        return 'tmux';
    }
    return (env['WT_SESSION'] ?? '') === '' ? undefined : 'windows-terminal';
}
/** The terminals `auto` tries, in order: tmux inside tmux, then the platform's own. */
export function autoTerminals(env, platform) {
    const inTmux = (env['TMUX'] ?? '') === '' ? [] : ['tmux'];
    switch (platform) {
        case 'win32':
            return [...inTmux, 'windows-terminal'];
        case 'darwin':
            return [...inTmux, 'macos-terminal'];
        default:
            return [...inTmux, 'gnome-terminal', 'konsole', 'x-terminal-emulator'];
    }
}
