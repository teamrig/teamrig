import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  folderStamp,
  installTeamrig,
  kitHomeOf,
  parseInstallArgs,
  releaseTagOf,
  RELEASE_REPO,
  runInstall,
  runProgram,
  type InstallEnvironment,
  type InstallInput,
  type InstallRun,
} from './install-teamrig.ts';

interface Call {
  readonly command: string;
  readonly args: readonly string[];
}

type Rule = { readonly when: (call: Call) => boolean; readonly give: InstallRun };

const SHA = 'a'.repeat(40);

/** What a release clone answers: its teamrig's version and its commit. */
const CLONE_RULES: readonly Rule[] = [
  { when: (call) => call.command !== 'git' && call.args.at(-1) === '--version', give: { code: 0, out: 'teamrig 1.2.3' } },
  { when: (call) => call.command === 'git' && call.args.includes('rev-parse'), give: { code: 0, out: SHA } },
];

/**
 * A runner that records each call and answers from the first rule whose test matches, then as a release clone does,
 * else exit 0 with no output.
 */
function fakeRunner(rules: readonly Rule[] = []) {
  const calls: Call[] = [];
  const run = (command: string, args: readonly string[]): InstallRun => {
    const call = { command, args };
    calls.push(call);
    return [...rules, ...CLONE_RULES].find((rule) => rule.when(call))?.give ?? { code: 0, out: '' };
  };
  return { calls, run };
}

const KIT = '/home/user/.teamrig';
const CLONE = '/home/user/.teamrig/install/teamrig';
const CLI = `${CLONE}/plugins/teamrig/dist/cli/main.js`;

const STAMP = '20261125T183005Z';
const FRESH = `${CLONE}.new-${STAMP}`;
const ASIDE = `${CLONE}.old-${STAMP}`;

/** A rename that records each move as `from>to`, and throws for the moves `failing` names. */
function fakeRename(failing: readonly string[] = []) {
  const moves: string[] = [];
  const rename = (from: string, to: string): void => {
    if (failing.includes(`${from}>${to}`)) {
      throw new Error('EPERM');
    }
    moves.push(`${from}>${to}`);
  };
  return { moves, rename };
}

function input(overrides: Partial<InstallInput> = {}, present: readonly string[] = []): InstallInput {
  return {
    kitHome: KIT,
    platform: 'linux',
    nodePath: '/usr/bin/node',
    hosts: [],
    write: false,
    exists: (path) => present.includes(path),
    rename: fakeRename().rename,
    cwd: '/home/user',
    stamp: STAMP,
    ...overrides,
  };
}

const words = (call: Call): string => [call.command, ...call.args].join(' ');

describe('installTeamrig', () => {
  it('clones the release branch shallowly into the teamrig home and runs the installed teamrig', () => {
    const { calls, run } = fakeRunner([{ when: (call) => call.args.includes('--version') && call.command === '/usr/bin/node', give: { code: 0, out: 'teamrig 1.2.3' } }]);
    const report = installTeamrig(input(), run);
    assert.equal(report.ok, true);
    assert.deepEqual(calls.map(words), [
      'git --version',
      `git clone -q --depth 1 --branch release ${RELEASE_REPO} ${FRESH}`,
      `/usr/bin/node ${FRESH}/plugins/teamrig/dist/cli/main.js --version`,
      `git -C ${FRESH} rev-parse HEAD`,
      `/usr/bin/node ${CLI} kit install --tag v1.2.3 --commit ${SHA}`,
    ]);
    assert.ok(report.lines.includes('teamrig 1.2.3'));
    assert.ok(report.lines.includes(`CLONED ${RELEASE_REPO} (release) into ${CLONE}`));
  });

  it("leaves the PATH to kit install, printing its lines and no step for the person to take by hand", () => {
    const added = 'ADD /home/you/.teamrig/bin to the user\'s PATH (/home/you/.profile), so terminals opened from now on run teamrig';
    const { run } = fakeRunner([
      { when: (call) => call.args.includes('--version') && call.command === '/usr/bin/node', give: { code: 0, out: 'teamrig 1.2.3' } },
      { when: (call) => call.args.includes('kit'), give: { code: 0, out: added } },
    ]);
    const report = installTeamrig(input({ write: true }), run);
    assert.equal(report.ok, true);
    assert.ok(report.lines.includes(added));
    assert.ok(!report.lines.some((line) => /on your PATH|export PATH=|Environment Variables/u.test(line)), report.lines.join('\n'));
  });

  it("installs the clone into the kit home, then connects each named host through the install's own setup hooks, writing only with --yes", () => {
    const preview = fakeRunner();
    const previewed = installTeamrig(input({ hosts: ['one', 'two'] }), preview.run);
    assert.deepEqual(preview.calls.slice(4).map(words), [
      `/usr/bin/node ${CLI} kit install --tag v1.2.3 --commit ${SHA}`,
      `/usr/bin/node ${CLI} setup hooks --host one`,
      `/usr/bin/node ${CLI} setup hooks --host two`,
    ]);
    assert.equal(previewed.lines.at(-1), 'Nothing was written to the kit home or the hosts yet: run it again with --yes to write them.');
    const written = fakeRunner();
    const report = installTeamrig(input({ hosts: ['one'], write: true }), written.run);
    assert.deepEqual(written.calls.slice(4).map(words), [
      `/usr/bin/node ${CLI} kit install --tag v1.2.3 --commit ${SHA} --yes`,
      `/usr/bin/node ${CLI} setup hooks --host one --yes`,
    ]);
    assert.match(report.lines.at(-1) ?? '', /trust teamrig's hooks/);
  });

  it('connects no host when the kit install fails, as their lines would run a kit home without this teamrig', () => {
    const { calls, run } = fakeRunner([{ when: (call) => call.args.includes('kit'), give: { code: 2, out: 'REFUSED busy' } }]);
    const report = installTeamrig(input({ hosts: ['one'], write: true }), run);
    assert.equal(report.ok, false);
    assert.equal(report.lines.at(-1), 'FAILED kit install (exit 2):\nREFUSED busy');
    assert.equal(calls.some((call) => call.args.includes('setup')), false);
  });

  it('stops before any move when the new teamrig prints no version, naming the folder it stays in', () => {
    const { run } = fakeRunner([{ when: (call) => call.args.at(-1) === '--version' && call.command === '/usr/bin/node', give: { code: 0, out: 'hello' } }]);
    const { moves, rename } = fakeRename();
    const report = installTeamrig(input({ rename }, [CLONE, `${CLONE}/.git`]), run);
    assert.equal(report.ok, false);
    assert.deepEqual(moves, []);
    assert.equal(report.lines.at(-1), `FAILED the new teamrig printed no version (hello); it stays in ${FRESH}; the install in use is unchanged`);
  });

  it('updates by a fresh clone beside the old install, moving the old one aside, never running git inside it', () => {
    const { calls, run } = fakeRunner();
    const { moves, rename } = fakeRename();
    const report = installTeamrig(input({ rename }, [CLONE, `${CLONE}/.git`]), run);
    assert.equal(report.ok, true);
    assert.deepEqual(calls.filter((call) => call.command === 'git' && call.args[0] === '-C').map((call) => call.args[1]), [FRESH]);
    assert.equal(calls[1]?.args.at(-1), FRESH);
    assert.deepEqual(moves, [`${CLONE}>${ASIDE}`, `${FRESH}>${CLONE}`]);
    assert.ok(report.lines.includes(`UPDATED ${RELEASE_REPO} (release) into ${CLONE}`));
    assert.ok(report.lines.includes(`KEPT the old install at ${ASIDE}: delete it once this one works`));
  });

  it('leaves the old install in place when the new clone or its teamrig fails', () => {
    const steps: readonly { readonly failing: string; readonly when: (call: Call) => boolean }[] = [
      { failing: 'clone', when: (call) => call.args[0] === 'clone' },
      { failing: 'new teamrig', when: (call) => call.command === '/usr/bin/node' },
      { failing: 'commit read', when: (call) => call.args.includes('rev-parse') },
    ];
    for (const { failing, when } of steps) {
      const { run } = fakeRunner([{ when, give: { code: 1, out: 'bad' } }]);
      const { moves, rename } = fakeRename();
      const report = installTeamrig(input({ rename }, [CLONE, `${CLONE}/.git`]), run);
      assert.equal(report.ok, false, failing);
      assert.deepEqual(moves, [], failing);
    }
  });

  it('moves the old install back when the new one cannot take its place', () => {
    const { moves, rename } = fakeRename([`${FRESH}>${CLONE}`]);
    const report = installTeamrig(input({ rename }, [CLONE, `${CLONE}/.git`]), fakeRunner().run);
    assert.equal(report.ok, false);
    assert.deepEqual(moves, [`${CLONE}>${ASIDE}`, `${ASIDE}>${CLONE}`]);
    assert.equal(report.lines.at(-1), `FAILED move ${FRESH} to ${CLONE}: Error: EPERM; the install in use is unchanged`);
  });

  it('stops naming the move when the old install cannot be moved aside, connecting no host', () => {
    const { calls, run } = fakeRunner();
    const { moves, rename } = fakeRename([`${CLONE}>${ASIDE}`]);
    const report = installTeamrig(input({ rename, hosts: ['one'] }, [CLONE, `${CLONE}/.git`]), run);
    assert.equal(report.ok, false);
    assert.deepEqual(moves, []);
    assert.equal(report.lines.at(-1), `FAILED move ${CLONE} to ${ASIDE}: Error: EPERM`);
    assert.equal(calls.length, 4);
  });

  it('refuses on Windows when a git program sits in the current folder, before running anything', () => {
    const { calls, run } = fakeRunner();
    const planted = 'D:\\people\\you\\Downloads\\git.cmd';
    const report = installTeamrig(input({ platform: 'win32', kitHome: 'D:\\people\\you\\.teamrig', cwd: 'D:\\people\\you\\Downloads' }, [planted]), run);
    assert.equal(report.ok, false);
    assert.deepEqual(calls, []);
    assert.equal(report.lines.at(-1), `REFUSED ${planted} would run as git; run this from your home folder (cd ~) instead`);
  });

  it('refuses a folder at the install path that is no git clone, running nothing past git --version', () => {
    const { calls, run } = fakeRunner();
    const report = installTeamrig(input({}, [CLONE]), run);
    assert.equal(report.ok, false);
    assert.match(report.lines.join('\n'), /REFUSED .* is not a teamrig install; move it away/);
    assert.deepEqual(calls.map(words), ['git --version']);
  });

  it('stops at the first failing step with its exit and output', () => {
    const { calls, run } = fakeRunner([{ when: (call) => call.args.includes('clone'), give: { code: 128, out: 'fatal: unable to access' } }]);
    const report = installTeamrig(input({ hosts: ['one'] }), run);
    assert.equal(report.ok, false);
    assert.equal(report.lines.at(-1), 'FAILED clone the release branch (exit 128):\nfatal: unable to access');
    assert.equal(calls.length, 2);
  });

  it('asks for git when it is missing', () => {
    const { run } = fakeRunner([{ when: (call) => words(call) === 'git --version', give: { code: -1, out: 'Error: spawnSync git ENOENT' } }]);
    assert.match(installTeamrig(input(), run).lines.join('\n'), /FAILED git is needed: install it from https:\/\/git-scm\.com \(exit -1\)/);
  });

  it('builds Windows paths on win32', () => {
    const { calls, run } = fakeRunner();
    const report = installTeamrig(input({ kitHome: 'D:\\people\\you\\.teamrig', platform: 'win32', nodePath: 'node.exe' }), run);
    assert.equal(calls[1]?.args.at(-1), `D:\\people\\you\\.teamrig\\install\\teamrig.new-${STAMP}`);
    assert.ok(report.lines.includes('teamrig is installed at D:\\people\\you\\.teamrig\\install\\teamrig\\plugins\\teamrig.'), report.lines.join('\n'));
  });

  it('tells a run with no --host how to connect one', () => {
    assert.match(installTeamrig(input(), fakeRunner().run).lines.at(-1) ?? '', /run this again with --host <name>/);
  });
});

describe('releaseTagOf', () => {
  it("gives the release tag of a teamrig version line, a prerelease's too", () => {
    assert.deepEqual([releaseTagOf('teamrig 0.510.0\n'), releaseTagOf('teamrig 0.510.0-preview.2')], ['v0.510.0', 'v0.510.0-preview.2']);
  });

  it('gives none for any other output', () => {
    assert.deepEqual([releaseTagOf(''), releaseTagOf('teamrig'), releaseTagOf('teamrig 0.510.0 extra'), releaseTagOf('warning\nteamrig 0.510.0')], [undefined, undefined, undefined, undefined]);
  });
});

describe('folderStamp', () => {
  it('gives a UTC stamp holding no character a folder name refuses', () => {
    assert.equal(folderStamp(new Date('2026-11-25T18:30:05.123Z')), STAMP);
  });
});

describe('parseInstallArgs', () => {
  it('takes repeated --host and --yes', () => {
    assert.deepEqual(parseInstallArgs(['--host', 'one', '--yes', '--host', 'two']), { kind: 'args', hosts: ['one', 'two'], write: true });
  });

  it('refuses --host with no name and an unknown word', () => {
    assert.deepEqual(parseInstallArgs(['--host']), { kind: 'usage', problem: '--host needs a host name' });
    assert.deepEqual(parseInstallArgs(['--host', '--yes']), { kind: 'usage', problem: '--host needs a host name' });
    assert.deepEqual(parseInstallArgs(['--force']), { kind: 'usage', problem: 'unknown argument --force' });
  });
});

function environment(run: InstallEnvironment['run']) {
  const out: string[] = [];
  const err: string[] = [];
  const env: InstallEnvironment = {
    teamrigHome: undefined,
    platform: 'linux',
    nodePath: '/usr/bin/node',
    home: '/home/user',
    exists: () => false,
    rename: fakeRename().rename,
    cwd: '/home/user',
    now: new Date('2026-11-25T18:30:05Z'),
    run,
    print: (line) => out.push(line),
    printError: (line) => err.push(line),
  };
  return { env, out, err };
}

describe('runInstall', () => {
  it('prints a usage problem and gives 2, running nothing', () => {
    const { calls, run } = fakeRunner();
    const { env, out, err } = environment(run);
    assert.equal(runInstall(['--force'], env), 2);
    assert.deepEqual(err, ['unknown argument --force\nusage: node install-teamrig.ts [--host <name>]... [--yes]']);
    assert.deepEqual([out, calls], [[], []]);
  });

  it('installs under the home folder\'s .teamrig, printing to out and giving 0', () => {
    const { calls, run } = fakeRunner();
    const { env, out, err } = environment(run);
    assert.equal(runInstall(['--host', 'one'], env), 0);
    assert.equal(calls[1]?.args.at(-1), FRESH);
    assert.ok(out.some((line) => line.startsWith('CLONED ')));
    assert.deepEqual(err, []);
  });

  it('prints a failed step to err and gives 1', () => {
    const { run } = fakeRunner([{ when: (call) => call.args.includes('clone'), give: { code: 128, out: 'fatal' } }]);
    const { env, out, err } = environment(run);
    assert.equal(runInstall([], { ...env, teamrigHome: '/kits/mine' }), 1);
    assert.deepEqual(out, []);
    assert.equal(err.at(-1), 'FAILED clone the release branch (exit 128):\nfatal');
  });
});

describe('runProgram', () => {
  it('gives the exit code and both streams of a program run to its end', () => {
    const result = runProgram(process.execPath, ['-e', 'process.stdout.write("out ");process.stderr.write("err");process.exit(3)']);
    assert.deepEqual(result, { code: 3, out: 'out err' });
  });

  it('gives -1 and the start error for a program that cannot start', () => {
    const result = runProgram('teamrig-install-no-such-program', []);
    assert.equal(result.code, -1);
    assert.match(result.out, /ENOENT/);
  });
});

describe('kitHomeOf', () => {
  it('takes TEAMRIG_HOME when set, else .teamrig under the home folder', () => {
    assert.equal(kitHomeOf('/kits/mine', 'linux', '/home/user'), '/kits/mine');
    assert.equal(kitHomeOf('  ', 'linux', '/home/user'), '/home/user/.teamrig');
    assert.equal(kitHomeOf(undefined, 'win32', 'D:\\people\\you'), 'D:\\people\\you\\.teamrig');
  });
});
