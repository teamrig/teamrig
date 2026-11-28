/** The window of a team's own its tabs open in when `open.teamWindow` is on, apart from other teams' tabs (T1427). */
export function teamWindowOf(teamWindow, team) {
    return teamWindow ? `teamrig-${team}` : undefined;
}
/**
 * The terminal this run works in, found by the variables it sets in its panes, when it can split that pane: tmux
 * alone, as its split names the run's own pane. Windows Terminal is not one: `wt.exe split-pane` splits whichever pane
 * has the focus in its most recent window, the tab the person is reading, not the session's (T5831).
 */
export function splittableTerminal(env) {
    return (env['TMUX'] ?? '') === '' ? undefined : 'tmux';
}
/**
 * The terminal this run works in when it can open a tab in the run's own window but not split its pane: Windows
 * Terminal, found by `WT_SESSION`, whose `-w 0` is its most recent window (T5831). tmux splits instead.
 */
export function tabbingTerminal(env) {
    return (env['TMUX'] ?? '') !== '' || (env['WT_SESSION'] ?? '') === '' ? undefined : 'windows-terminal';
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
