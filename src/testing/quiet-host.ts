import type { CliRuntime } from '../cli/runtime.ts';
import { SHIPPED_HOST, shippedHost } from './host.ts';
import { FakePluginStore } from './fake-plugin-store.ts';
import { quietRestore } from './fake-restore.ts';
import { FakeSessionProcesses } from './fake-session-processes.ts';
import { FakeShell } from './fake-shell.ts';
import { MemoryTranscripts } from './memory-transcripts.ts';

/** The machine a run works on: the AI CLI host and its sessions, the operating system, its programs and stdin. */
export type HostWorld = Pick<
  CliRuntime,
  | 'readStdin'
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
>;

/**
 * The machine when a run does not care about it: `stdin` on stdin and a Linux host with no programs or folders and an
 * empty plugin store, so nothing starts and no session process runs, a shell command prints nothing and exits 0, its
 * requirements check finds nothing missing, and there are no transcripts.
 */
export function quietHost(stdin: string): HostWorld {
  return {
    readStdin: async () => stdin,
    platform: 'linux',
    host: SHIPPED_HOST,
    shippedHosts: [shippedHost(SHIPPED_HOST)],
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
  };
}
