import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { installTeamrig, kitHomeOf, parseInstallArgs, RELEASE_REPO, type InstallInput, type InstallRun } from './install-teamrig.ts';

interface Call {
  readonly command: string;
  readonly args: readonly string[];
}

/** A runner that records each call and answers from the first rule whose test matches, else exit 0 with no output. */
function fakeRunner(rules: readonly { readonly when: (call: Call) => boolean; readonly give: InstallRun }[] = []) {
  const calls: Call[] = [];
  const run = (command: string, args: readonly string[]): InstallRun => {
    const call = { command, args };
    calls.push(call);
    return rules.find((rule) => rule.when(call))?.give ?? { code: 0, out: '' };
  };
  return { calls, run };
}

const KIT = '/home/user/.teamrig';
const CLONE = '/home/user/.teamrig/install/teamrig';
const CLI = `${CLONE}/plugins/teamrig/dist/cli/main.js`;

function input(overrides: Partial<InstallInput> = {}, present: readonly string[] = []): InstallInput {
  return { kitHome: KIT, platform: 'linux', nodePath: '/usr/bin/node', hosts: [], write: false, exists: (path) => present.includes(path), ...overrides };
}

const words = (call: Call): string => [call.command, ...call.args].join(' ');

describe('installTeamrig', () => {
  it('clones the release branch shallowly into the teamrig home and runs the installed teamrig', () => {
    const { calls, run } = fakeRunner([{ when: (call) => call.args.includes('--version') && call.command === '/usr/bin/node', give: { code: 0, out: 'teamrig 1.2.3' } }]);
    const report = installTeamrig(input(), run);
    assert.equal(report.ok, true);
    assert.deepEqual(calls.map(words), ['git --version', `git clone -q --depth 1 --branch release ${RELEASE_REPO} ${CLONE}`, `/usr/bin/node ${CLI} --version`]);
    assert.ok(report.lines.includes('teamrig 1.2.3'));
    assert.ok(report.lines.some((line) => line.includes(`export PATH="${CLONE}/plugins/teamrig/bin:$PATH"`)));
  });

  it('connects each named host through the install\'s own setup hooks, writing only with --yes', () => {
    const preview = fakeRunner();
    installTeamrig(input({ hosts: ['one', 'two'] }), preview.run);
    assert.deepEqual(preview.calls.slice(3).map(words), [`/usr/bin/node ${CLI} setup hooks --host one`, `/usr/bin/node ${CLI} setup hooks --host two`]);
    const written = fakeRunner();
    const report = installTeamrig(input({ hosts: ['one'], write: true }), written.run);
    assert.equal(words(written.calls[3] ?? { command: '', args: [] }), `/usr/bin/node ${CLI} setup hooks --host one --yes`);
    assert.match(report.lines.at(-1) ?? '', /trust teamrig's hooks/);
  });

  it('updates its own clone to the newest release on a later run', () => {
    const { calls, run } = fakeRunner([{ when: (call) => call.args.includes('get-url'), give: { code: 0, out: 'https://github.com/teamrig/teamrig' } }]);
    const report = installTeamrig(input({}, [`${CLONE}/.git`]), run);
    assert.equal(report.ok, true);
    assert.deepEqual(calls.slice(1, 4).map(words), [
      `git -C ${CLONE} remote get-url origin`,
      `git -C ${CLONE} fetch -q --depth 1 origin release`,
      `git -C ${CLONE} checkout -q --detach FETCH_HEAD`,
    ]);
  });

  it('refuses a clone of another repository and leaves it alone', () => {
    const { calls, run } = fakeRunner([{ when: (call) => call.args.includes('get-url'), give: { code: 0, out: 'https://example.invalid/other.git' } }]);
    const report = installTeamrig(input({}, [`${CLONE}/.git`]), run);
    assert.equal(report.ok, false);
    assert.match(report.lines.join('\n'), /REFUSED .* not https:\/\/github\.com\/teamrig\/teamrig\.git; move it away/);
    assert.equal(calls.some((call) => call.args.includes('fetch') || call.args.includes('checkout')), false);
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

  it('builds Windows paths and the Windows PATH step on win32', () => {
    const { calls, run } = fakeRunner();
    const report = installTeamrig(input({ kitHome: 'D:\\people\\you\\.teamrig', platform: 'win32', nodePath: 'node.exe' }), run);
    assert.equal(calls[1]?.args.at(-1), 'D:\\people\\you\\.teamrig\\install\\teamrig');
    assert.ok(report.lines.some((line) => line.includes('Environment Variables > Path > New: D:\\people\\you\\.teamrig\\install\\teamrig\\plugins\\teamrig\\bin')));
  });

  it('tells a run with no --host how to connect one', () => {
    assert.match(installTeamrig(input(), fakeRunner().run).lines.at(-1) ?? '', /run this again with --host <name>/);
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

describe('kitHomeOf', () => {
  it('takes TEAMRIG_HOME when set, else .teamrig under the home folder', () => {
    assert.equal(kitHomeOf('/kits/mine', 'linux', '/home/user'), '/kits/mine');
    assert.equal(kitHomeOf('  ', 'linux', '/home/user'), '/home/user/.teamrig');
    assert.equal(kitHomeOf(undefined, 'win32', 'D:\\people\\you'), 'D:\\people\\you\\.teamrig');
  });
});
