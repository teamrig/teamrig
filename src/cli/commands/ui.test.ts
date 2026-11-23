import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { APP, CliHarness, KIT, TEAM } from '../../testing/cli-harness.ts';
import { FakeHttp } from '../../testing/fake-http.ts';
import { FakePathProbe, FakeProcesses } from '../../testing/fake-processes.ts';
import { normalisePath } from '../../testing/memory-files.ts';
import { ARCHIVE_FORMAT, sha256Hex } from '../../ui/archive.ts';
import type { UiPin } from '../../ui/released.ts';
import type { ParsedArgs } from '../args.ts';
import { RefusedError } from '../runtime.ts';
import { uiCommand } from './ui.ts';

const ENTRY = resolve('/', 'pane', 'out', 'ui', 'main.js');
const NODE = '/usr/bin/node';
const SCRIPT = '/opt/teamrig/dist/cli/main.js';
const WITH_UI = { ...TEAM, ui: { path: ENTRY } };

function argsOf(flags: Readonly<Record<string, string>> = {}): ParsedArgs {
  return { command: 'ui', positionals: [], flags: new Map(Object.entries(flags)), switches: new Set(), rest: [], help: false, common: new Map() };
}

function world(): { processes: FakeProcesses; probe: FakePathProbe } {
  return { processes: new FakeProcesses(), probe: new FakePathProbe({ files: [ENTRY] }) };
}

describe('teamrig ui', () => {
  it('runs the entry ui.path names under its own node, for the team here, in the caller’s folder', async () => {
    const { processes, probe } = world();
    const result = await new CliHarness(WITH_UI).run(['ui'], { processes, probe, env: { PATH: '/bin' } });
    assert.deepEqual(result, { code: 0, stdout: [], stderr: [] });
    assert.deepEqual(processes.ran, [
      { command: NODE, args: [ENTRY, '--team', 'app'], cwd: APP, env: { TEAMRIG_HOME: KIT, PATH: '/bin', TEAMRIG_TEAM: 'app', TEAMRIG_CLI: SCRIPT, TEAMRIG_NODE: NODE } },
    ]);
  });

  it('opens on the session --session names, by its id', async () => {
    const { processes, probe } = world();
    const result = await new CliHarness(WITH_UI).run(['ui', '--session', 'app-alpha'], { processes, probe });
    assert.equal(result.code, 0);
    assert.deepEqual(processes.ran[0]?.args, [ENTRY, '--team', 'app', '--session', 'alpha']);
  });

  it('refuses a session the team lacks and starts nothing', async () => {
    const { processes, probe } = world();
    const result = await new CliHarness(WITH_UI).run(['ui', '--session', 'zulu'], { processes, probe });
    assert.equal(result.code, 2);
    assert.deepEqual(processes.ran, []);
  });

  it('shows the team --team names from a folder of no team', async () => {
    const { processes, probe } = world();
    const cwd = resolve('/', 'elsewhere');
    const result = await new CliHarness(WITH_UI, null).run(['ui', '--team', 'app'], { processes, probe, cwd });
    assert.equal(result.code, 0);
    assert.deepEqual([processes.ran[0]?.args, processes.ran[0]?.cwd], [[ENTRY, '--team', 'app'], cwd]);
  });

  it('refuses a --team that is no team id, or one with no config, and starts nothing', async () => {
    const { processes, probe } = world();
    const kit = new CliHarness(WITH_UI);
    const bad = await kit.run(['ui', '--team', join('..', 'app')], { processes, probe });
    assert.equal(bad.code, 64);
    const none = await kit.run(['ui', '--team', 'other'], { processes, probe });
    assert.equal(none.code, 2);
    assert.match(none.stdout.join('\n'), /^REFUSED no team config/);
    assert.deepEqual(processes.ran, []);
  });

  it('is refused without ui.path in a build that pins no release, saying so and naming the key', async () => {
    const { processes, probe } = world();
    await assert.rejects(
      uiCommand(undefined)(argsOf(), new CliHarness().runtime({ processes, probe })),
      (error: unknown) => error instanceof RefusedError && /^no released UI is pinned in this teamrig yet; set ui\.path /.test(error.message),
    );
    assert.deepEqual(processes.ran, []);
  });

  it('is refused when ui.path names no file, a folder included', async () => {
    for (const probe of [new FakePathProbe(), new FakePathProbe({ folders: [ENTRY] })]) {
      const processes = new FakeProcesses();
      const result = await new CliHarness(WITH_UI).run(['ui'], { processes, probe });
      assert.equal(result.code, 2);
      assert.match(result.stdout.join('\n'), /^REFUSED ui\.path names .*main\.js, and no file is there/);
      assert.deepEqual(processes.ran, []);
    }
  });

  it('fails with the UI’s exit code named, and when node is gone or cannot start', async () => {
    const outcomes = [
      [{ kind: 'exited', code: 143 }, 'FAILED the UI exited with code 143'],
      [{ kind: 'missing' }, `FAILED ${NODE} is gone`],
      [{ kind: 'failed', error: 'EACCES' }, `FAILED ${NODE}: EACCES`],
    ] as const;
    for (const [outcome, line] of outcomes) {
      const processes = new FakeProcesses().onRun(NODE, outcome);
      const result = await new CliHarness(WITH_UI).run(['ui'], { processes, probe: new FakePathProbe({ files: [ENTRY] }) });
      assert.deepEqual([result.code, result.stderr], [1, [line]]);
    }
  });

  describe('the released UI, without ui.path', () => {
    const VERSION = '0.77.0';
    const URL = 'https://releases.example/pane/teamrig-ui.json';
    const ARCHIVE = `${JSON.stringify({
      format: ARCHIVE_FORMAT,
      version: VERSION,
      interface: '1.0',
      entry: 'ui/main.js',
      files: [
        { path: 'package.json', text: '{"type":"module"}\n' },
        { path: 'ui/main.js', text: 'export {};\n' },
      ],
    })}\n`;
    const PIN: UiPin = { version: VERSION, url: URL, sha256: sha256Hex(new TextEncoder().encode(ARCHIVE)) };
    const RELEASED_ENTRY = `${normalisePath(KIT)}/ui/${VERSION}-${PIN.sha256}/ui/main.js`;
    const CALLER_ENV = { PATH: '/bin', LANG: 'C.UTF-8', GH_TOKEN: 'token', NODE_OPTIONS: '--require /x.js' };

    it('fetches and installs the pinned UI once, then runs it with only the allowed variables', async () => {
      const kit = new CliHarness();
      const http = new FakeHttp().answers('GET', URL, 200, ARCHIVE);
      const processes = new FakeProcesses();
      const start = uiCommand(PIN);
      assert.equal(await start(argsOf(), kit.runtime({ processes, http, env: CALLER_ENV })), 0);
      assert.equal(await start(argsOf(), kit.runtime({ processes, http, env: CALLER_ENV })), 0);
      assert.equal(http.requests.length, 1);
      assert.deepEqual(
        processes.ran.map((ran) => [ran.command, normalisePath(ran.args[0] ?? ''), ran.args.slice(1), ran.env]),
        [0, 1].map(() => [NODE, RELEASED_ENTRY, ['--team', 'app'], { TEAMRIG_HOME: KIT, PATH: '/bin', LANG: 'C.UTF-8', TEAMRIG_TEAM: 'app', TEAMRIG_CLI: SCRIPT, TEAMRIG_NODE: NODE }]),
      );
    });

    it('runs ui.path, with the whole environment, over the pin, and fetches nothing', async () => {
      const http = new FakeHttp();
      const { processes, probe } = world();
      assert.equal(await uiCommand(PIN)(argsOf(), new CliHarness(WITH_UI).runtime({ processes, probe, http, env: CALLER_ENV })), 0);
      assert.deepEqual(http.requests, []);
      assert.deepEqual(processes.ran[0]?.args[0], ENTRY);
      assert.deepEqual(processes.ran[0]?.env, { TEAMRIG_HOME: KIT, ...CALLER_ENV, TEAMRIG_TEAM: 'app', TEAMRIG_CLI: SCRIPT, TEAMRIG_NODE: NODE });
    });

    it('is refused, starting nothing, when the fetched archive misses the pin or cannot be fetched', async () => {
      for (const [http, reason] of [
        [new FakeHttp().answers('GET', URL, 200, `${ARCHIVE} `), /^the fetched UI 0\.77\.0 was refused: /],
        [new FakeHttp().answers('GET', URL, 404), /^the UI 0\.77\.0 could not be fetched: the server answered 404$/],
      ] as const) {
        const processes = new FakeProcesses();
        await assert.rejects(uiCommand(PIN)(argsOf(), new CliHarness().runtime({ processes, http })), (error: unknown) => error instanceof RefusedError && reason.test(error.message));
        assert.deepEqual(processes.ran, []);
      }
    });
  });

  describe('--mode and ui.mode (T5105)', () => {
    const IN_TMUX = { ...WITH_UI, open: { terminal: 'tmux' } };
    // The window's UI carries this kit home, so it reads the same teams as the command that opened it.
    const WINDOW_ARGV = [NODE, SCRIPT, 'ui', '--mode', 'terminal', '--team', 'app', '--home', resolve(APP, KIT)];

    function opening(): { processes: FakeProcesses; probe: FakePathProbe } {
      return { processes: new FakeProcesses().onStart('tmux', { kind: 'started', end: 'exited' }), probe: new FakePathProbe({ files: [ENTRY] }) };
    }

    it('window opens a terminal window running the UI in terminal mode, on the session named, and runs nothing here', async () => {
      const { processes, probe } = opening();
      const result = await new CliHarness(IN_TMUX).run(['ui', '--mode', 'window', '--session', 'alpha'], { processes, probe });
      assert.deepEqual(result, { code: 0, stdout: ['OPENED the UI in a tmux window'], stderr: [] });
      assert.deepEqual(processes.started.map((started) => [started.command, started.args]), [
        ['tmux', ['new-window', '-c', APP, '-n', 'teamrig ui app', ...WINDOW_ARGV, '--session', 'alpha']],
      ]);
      assert.deepEqual(processes.ran, []);
    });

    it('takes the mode from ui.mode when --mode is absent, and --mode wins over it', async () => {
      const windowed = { ...IN_TMUX, ui: { path: ENTRY, mode: 'window' } };
      const fromConfig = opening();
      assert.equal((await new CliHarness(windowed).run(['ui'], fromConfig)).code, 0);
      assert.deepEqual([fromConfig.processes.started.length, fromConfig.processes.ran.length], [1, 0]);
      const overridden = opening();
      assert.equal((await new CliHarness(windowed).run(['ui', '--mode', 'terminal'], overridden)).code, 0);
      assert.deepEqual([overridden.processes.started.length, overridden.processes.ran.length], [0, 1]);
    });

    it('both opens the window and then shows the UI here too', async () => {
      const { processes, probe } = opening();
      const result = await new CliHarness(IN_TMUX).run(['ui', '--mode', 'both'], { processes, probe });
      assert.deepEqual([result.code, result.stdout], [0, ['OPENED the UI in a tmux window']]);
      assert.deepEqual(processes.started[0]?.args.slice(5), WINDOW_ARGV);
      assert.deepEqual(processes.ran.map((ran) => ran.args), [[ENTRY, '--team', 'app']]);
    });

    it('falls back to this terminal, saying why, when no window can open', async () => {
      const processes = new FakeProcesses();
      const result = await new CliHarness(IN_TMUX).run(['ui', '--mode', 'window'], { processes, probe: new FakePathProbe({ files: [ENTRY] }) });
      assert.deepEqual([result.code, result.stdout], [0, ['NOTE no terminal window opened (tmux: tmux is not installed); the UI shows in this terminal']]);
      assert.deepEqual(processes.ran.map((ran) => ran.args), [[ENTRY, '--team', 'app']]);
    });

    it('opens no window on a UI that cannot start', async () => {
      const processes = new FakeProcesses().onStart('tmux', { kind: 'started', end: 'exited' });
      const result = await new CliHarness(IN_TMUX).run(['ui', '--mode', 'window'], { processes, probe: new FakePathProbe() });
      assert.equal(result.code, 2);
      assert.deepEqual([processes.started, processes.ran], [[], []]);
    });

    describe('run with no terminal of its own, as from an AI CLI’s shell tool', () => {
      const TMUX_ENV = { TMUX: '/tmp/tmux-1/default,1,0' };

      it('terminal splits the session’s tmux pane, the focus kept on it, and runs nothing here', async () => {
        const { processes, probe } = opening();
        const result = await new CliHarness(WITH_UI).run(['ui', '--session', 'alpha'], { processes, probe, env: TMUX_ENV, interactive: false });
        assert.deepEqual(result, { code: 0, stdout: ['OPENED the UI in a split of this tmux window'], stderr: [] });
        assert.deepEqual(processes.started.map((started) => [started.command, started.args]), [
          ['tmux', ['split-window', '-h', '-d', '-c', APP, ...WINDOW_ARGV, '--session', 'alpha']],
        ]);
        assert.deepEqual(processes.ran, []);
      });

      it('terminal opens a window, saying why, when the terminal cannot split', async () => {
        const { processes, probe } = opening();
        const result = await new CliHarness(IN_TMUX).run(['ui'], { processes, probe, interactive: false });
        assert.deepEqual(result.stdout, [
          'NOTE no split of this terminal opened (this terminal is neither tmux nor Windows Terminal, the ones that split)',
          'OPENED the UI in a tmux window',
        ]);
        assert.deepEqual(processes.started.map((started) => started.args[0]), ['new-window']);
        assert.deepEqual(processes.ran, []);
      });

      it('runs here, saying so, only when neither a split nor a window opens', async () => {
        const processes = new FakeProcesses();
        const result = await new CliHarness(IN_TMUX).run(['ui'], { processes, probe: new FakePathProbe({ files: [ENTRY] }), interactive: false });
        assert.deepEqual(result.stdout, [
          'NOTE no split of this terminal opened (this terminal is neither tmux nor Windows Terminal, the ones that split)',
          'NOTE no terminal window opened (tmux: tmux is not installed); the UI shows in this terminal',
        ]);
        assert.deepEqual(processes.ran.map((ran) => ran.args), [[ENTRY, '--team', 'app']]);
      });

      it('both opens the window and the split, and runs nothing here', async () => {
        const { processes, probe } = opening();
        const result = await new CliHarness(IN_TMUX).run(['ui', '--mode', 'both'], { processes, probe, env: TMUX_ENV, interactive: false });
        assert.deepEqual(result.stdout, ['OPENED the UI in a tmux window', 'OPENED the UI in a split of this tmux window']);
        assert.deepEqual(processes.started.map((started) => started.args[0]), ['new-window', 'split-window']);
        assert.deepEqual(processes.ran, []);
      });

      it('window falls back to a split beside the session when no window opens', async () => {
        const processes = new FakeProcesses().onStart('wt.exe', { kind: 'started', end: 'exited' });
        const config = { ...WITH_UI, open: { terminal: 'gnome-terminal' } };
        const result = await new CliHarness(config).run(['ui', '--mode', 'window'], { processes, probe: new FakePathProbe({ files: [ENTRY] }), env: { WT_SESSION: 'guid' }, interactive: false });
        assert.deepEqual(result.stdout, ['NOTE no terminal window opened (gnome-terminal: gnome-terminal is not installed); the UI shows beside the session', 'OPENED the UI in a split of this windows-terminal window']);
        assert.deepEqual(processes.ran, []);
      });
    });

    it('refuses a --mode that is no mode, starting nothing', async () => {
      const { processes, probe } = opening();
      const result = await new CliHarness(IN_TMUX).run(['ui', '--mode', 'tab'], { processes, probe });
      assert.equal(result.code, 64);
      assert.match(result.stderr.join('\n'), /--mode tab is no UI mode: expected one of terminal, window, both/);
      assert.deepEqual([processes.started, processes.ran], [[], []]);
    });
  });

  it('takes no positional word', async () => {
    const { processes, probe } = world();
    const result = await new CliHarness(WITH_UI).run(['ui', 'alpha'], { processes, probe });
    assert.equal(result.code, 64);
    assert.deepEqual(processes.ran, []);
  });
});
