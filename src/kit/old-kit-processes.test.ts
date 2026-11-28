import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { oldKitProcesses, type CommandLineProcess } from './old-kit-processes.ts';

const WINDOWS = {
  roots: ['D:\\team\\.teamrig\\versions', 'D:\\team\\.host\\plugins\\cache\\teamrig\\teamrig'],
  current: '0.510.0',
  platform: 'win32',
} as const;

const POSIX = {
  roots: ['/opt/team/.teamrig/versions', '/opt/team/.host/plugins/cache/teamrig/teamrig'],
  current: '0.510.0',
  platform: 'linux',
} as const;

function run(pid: number, commandLine: string): CommandLineProcess {
  return { pid, commandLine };
}

describe('oldKitProcesses', () => {
  it("matches an older version's events watcher and ui, by each form of its CLI entry on Windows", () => {
    const found = oldKitProcesses(
      [
        run(1, 'C:\\node\\node.exe D:/team/.host/plugins/cache/teamrig/teamrig/0.505.0/dist/cli/main.js events --json --session a'),
        run(2, '"C:\\Program Files\\Git\\usr\\bin\\sh.exe" /d/team/.host/plugins/cache/teamrig/teamrig/0.504.0/bin/teamrig ui'),
        run(3, 'C:\\node\\node.exe D:/team/.host/plugins/cache/teamrig/teamrig/0.504.0/bin/../dist/cli/main.js ui'),
        run(4, 'C:\\node\\node.exe D:\\team\\.host\\plugins\\cache\\teamrig\\teamrig\\0.508.0\\dist\\cli\\main.js ui --mode terminal'),
        run(5, 'node.exe "D:\\Team\\.teamrig\\versions\\0.509.1\\dist\\cli\\main.js" events --json'),
      ],
      WINDOWS,
    );
    assert.deepEqual(found, [
      { pid: 1, version: '0.505.0', word: 'events' },
      { pid: 2, version: '0.504.0', word: 'ui' },
      { pid: 3, version: '0.504.0', word: 'ui' },
      { pid: 4, version: '0.508.0', word: 'ui' },
      { pid: 5, version: '0.509.1', word: 'events' },
    ]);
  });

  it('matches on POSIX, where a path keeps its case', () => {
    const found = oldKitProcesses(
      [
        run(7, 'node /opt/team/.teamrig/versions/0.500.0/dist/cli/main.js events --json'),
        run(8, 'node /opt/team/.TEAMRIG/versions/0.500.0/dist/cli/main.js events --json'),
        run(9, 'sh /opt/team/.host/plugins/cache/teamrig/teamrig/0.499.0/bin/teamrig ui'),
      ],
      POSIX,
    );
    assert.deepEqual(found, [
      { pid: 7, version: '0.500.0', word: 'events' },
      { pid: 9, version: '0.499.0', word: 'ui' },
    ]);
  });

  it('leaves the current version, a newer one and a folder that is no release version alone', () => {
    const found = oldKitProcesses(
      [
        run(1, 'node /opt/team/.teamrig/versions/0.510.0/dist/cli/main.js events --json'),
        run(2, 'node /opt/team/.teamrig/versions/0.511.0/dist/cli/main.js ui'),
        run(3, 'node /opt/team/.teamrig/versions/0.500.0-rc.1/dist/cli/main.js ui'),
        run(4, 'node /opt/team/.teamrig/versions/0.99.0/dist/cli/main.js ui'),
      ],
      POSIX,
    );
    assert.deepEqual(found, [{ pid: 4, version: '0.99.0', word: 'ui' }]);
  });

  it('leaves every other command of an older version, and the UI child it started, to the tree end', () => {
    const found = oldKitProcesses(
      [
        run(1, 'node /opt/team/.teamrig/versions/0.500.0/dist/cli/main.js launch tr-ui --team teamrig'),
        run(2, 'node /opt/team/.teamrig/versions/0.500.0/dist/cli/main.js hook session-start'),
        run(3, 'node /opt/team/.teamrig/ui/0.80.0-abc/ui/main.js --team teamrig'),
        run(4, 'node /opt/team/.teamrig/versions/0.500.0/dist/cli/main.js list --session ui'),
      ],
      POSIX,
    );
    assert.deepEqual(found, []);
  });

  it('never matches by a name alone, a path outside the roots, or a folder that is no version', () => {
    const found = oldKitProcesses(
      [
        run(1, 'teamrig events --json'),
        run(2, 'node /opt/team/other/0.500.0/dist/cli/main.js events'),
        run(3, 'node /opt/team/.teamrig/versions/latest/dist/cli/main.js events'),
        run(4, 'node /opt/team/.teamrig/versions/extra/0.500.0/dist/cli/main.js events'),
        run(5, ''),
      ],
      POSIX,
    );
    assert.deepEqual(found, []);
  });

  it('matches nothing when current is no release version', () => {
    const found = oldKitProcesses([run(1, 'node /opt/team/.teamrig/versions/0.500.0/dist/cli/main.js events')], { ...POSIX, current: 'broken' });
    assert.deepEqual(found, []);
  });
});
