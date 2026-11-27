import type { CliRuntime } from '../cli/runtime.ts';
import { DEFAULT_HOST } from '../composition/adapters.ts';
import { NO_INSTALL_MARK } from '../kit/install-mark.ts';
import { SHIPPED_HOST, shippedHost } from './host.ts';
import { FakeFolderSignals } from './fake-folder-signals.ts';
import { FakePluginStore } from './fake-plugin-store.ts';
import { quietRestore } from './fake-restore.ts';
import { FakeSessionProcesses } from './fake-session-processes.ts';
import { FakeShell } from './fake-shell.ts';
import { MemoryTranscripts } from './memory-transcripts.ts';

/** The machine a run works on: the AI CLI host and its sessions, the operating system, its programs and stdin. */
export type HostWorld = Pick<
  CliRuntime,
  | 'readStdin'
  | 'interactive'
  | 'platform'
  | 'host'
  | 'shippedHosts'
  | 'processes'
  | 'sessionProcesses'
  | 'shell'
  | 'probe'
  | 'pluginStore'
  | 'self'
  | 'transcripts'
  | 'requirements'
  | 'restore'
  | 'kitTree'
  | 'installMark'
  | 'idleSleep'
  | 'folderSignals'
>;

/**
 * The machine when a run does not care about it: `stdin` on stdin, a terminal a person types in, and a Linux host with no programs or folders and an
 * empty plugin store, so nothing starts and no session process runs, a shell command prints nothing and exits 0, its
 * requirements check finds nothing missing, there are no transcripts, and a time limit's wait never ends (and holds
 * no timer), so no limit is reached.
 */
export function quietHost(stdin: string): HostWorld {
  return {
    readStdin: async () => stdin,
    interactive: true,
    platform: 'linux',
    host: SHIPPED_HOST,
    shippedHosts: { [DEFAULT_HOST]: shippedHost(SHIPPED_HOST) },
    processes: {
      start: async () => ({ kind: 'missing' }),
      run: async () => ({ kind: 'missing' }),
      startHidden: async () => ({ kind: 'missing' }),
    },
    sessionProcesses: new FakeSessionProcesses(),
    shell: new FakeShell(),
    probe: { kind: async () => 'none' },
    pluginStore: new FakePluginStore(),
    self: { node: '/usr/bin/node', script: '/opt/teamrig/dist/cli/main.js', execArgv: [] },
    transcripts: new MemoryTranscripts(),
    requirements: { problems: async () => [] },
    restore: quietRestore(),
    // The quiet client at /opt/teamrig has no integrity list, so a session start never reaches a copy.
    kitTree: {
      copyFolder: async () => {
        throw new Error('a quiet run copies no folder');
      },
      removeFolder: async () => undefined,
    },
    installMark: NO_INSTALL_MARK,
    idleSleep: () => new Promise<void>(() => undefined),
    // No folder can be watched, so `teamrig events` looks every second and a spec's change shows at the next wait.
    folderSignals: new FakeFolderSignals(() => false),
  };
}
