import { INTERFACE_VERSION } from "../../../plugin-api/index.js";
const UNSERVED = { kind: 'unserved' };
const NOT_INSTALLED = 'gnome-terminal is not installed';
/**
 * The GNOME Terminal port: a pane is a tab of the window GNOME Terminal picks. It hands back no id of the tab, so the
 * pane it answers is the title teamrig asked for, which finds nothing again; it opens panes and serves nothing else.
 */
export function gnomeTerminalPort(deps) {
    return {
        capabilities: async () => ({ requests: ['open'], interfaces: [INTERFACE_VERSION], seesDraft: false }),
        open: async (request) => {
            // gnome-terminal returns once its server has opened the tab, so its exit code says whether that worked.
            const outcome = await deps.processes.start({
                command: 'gnome-terminal',
                args: ['--tab', `--working-directory=${request.folder}`, '--', ...request.argv],
                cwd: request.folder,
                mode: 'exit',
            });
            switch (outcome.kind) {
                case 'started':
                    return { kind: 'opened', pane: request.title };
                case 'missing':
                    return { kind: 'failed', why: NOT_INSTALLED };
                case 'failed':
                    return { kind: 'failed', why: outcome.error };
            }
        },
        focus: async () => UNSERVED,
        close: async () => UNSERVED,
        restart: async () => UNSERVED,
        rename: async () => UNSERVED,
        deliver: async () => UNSERVED,
        isIdle: async () => UNSERVED,
        list: async () => UNSERVED,
    };
}
