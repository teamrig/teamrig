/** The window of a team's own its tabs open in when `open.teamWindow` is on, apart from other teams' tabs (T1427). */
export function teamWindowOf(teamWindow, team) {
    return teamWindow ? `teamrig-${team}` : undefined;
}
/**
 * Windows Terminal re-reads its command line: `;` starts its next command, and it may expand `%VAR%`
 * and re-quote `"`. The kit's own arguments (ids, base64url) never hold these; a path might.
 */
const WINDOWS_TERMINAL_UNSAFE = /[;"%\p{Cc}]/u;
function command(command, args, folder, mode) {
    return { kind: 'command', request: { command, args, cwd: folder, mode } };
}
/** The first argument Windows Terminal would misread, if any. */
function windowsTerminalUnsafe(tab) {
    const { title, folder, window, argv } = tab;
    return [title, folder, ...(window === undefined ? [] : [window]), ...argv].find((arg) => WINDOWS_TERMINAL_UNSAFE.test(arg));
}
function windowsTerminalRefusal(unsafe) {
    return { kind: 'unusable', why: `Windows Terminal would misread ${JSON.stringify(unsafe)} (it holds ; " % or a control character)` };
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
/**
 * The launcher call that splits the run's own terminal window and runs `argv` in the new pane, side by side (T5105).
 * tmux splits the pane the run works in (it names it in `TMUX_PANE`), and `-d` keeps the focus there; Windows
 * Terminal splits the active pane of its most recent window, the one the person is typing in, and `tab.window` is not
 * read: a split is of the window the run is in.
 */
export function splitCommand(terminal, tab) {
    const { title, folder, argv, focus } = tab;
    switch (terminal) {
        case 'tmux':
            return command('tmux', ['split-window', '-h', ...(focus === 'keep' ? ['-d'] : []), '-c', folder, ...argv], folder, 'exit');
        case 'windows-terminal': {
            const unsafe = windowsTerminalUnsafe({ ...tab, window: undefined });
            if (unsafe !== undefined) {
                return windowsTerminalRefusal(unsafe);
            }
            return command('wt.exe', ['-w', '0', 'split-pane', '--vertical', '--title', title, '-d', folder, '--', ...argv], folder, 'exit');
        }
    }
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
