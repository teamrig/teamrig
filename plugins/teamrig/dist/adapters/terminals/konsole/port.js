import { INTERFACE_VERSION } from "../../../plugin-api/index.js";
const UNSERVED = { kind: 'unserved' };
const NOT_INSTALLED = 'konsole is not installed';
/**
 * The Konsole port: a pane is a tab of the window Konsole picks. It hands back no id of the tab, so the pane it
 * answers is the title teamrig asked for, which finds nothing again; it opens panes and serves nothing else.
 */
export function konsolePort(deps) {
    return {
        capabilities: async () => ({ requests: ['open'], interfaces: [INTERFACE_VERSION], seesDraft: false }),
        open: async (request) => {
            // konsole is the window itself and stays up as long as it, so starting it is all there is to wait for.
            const outcome = await deps.processes.start({
                command: 'konsole',
                args: ['--new-tab', '--workdir', request.folder, '-e', ...request.argv],
                cwd: request.folder,
                mode: 'spawn',
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
        split: async () => UNSERVED,
        focus: async () => UNSERVED,
        close: async () => UNSERVED,
        restart: async () => UNSERVED,
        rename: async () => UNSERVED,
        deliver: async () => UNSERVED,
        isIdle: async () => UNSERVED,
        list: async () => UNSERVED,
    };
}
