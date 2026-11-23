import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256Of } from '../adapters/terminals/protocol/spawn.ts';
import { referenceTerminal, TERMINAL_CONTRACT, yesTerminal, type BoundCase } from '../conformance/index.ts';
import { OSES, type Os, type ProgramRunner } from '../plugin-api/index.ts';
import { terminalProgram, terminalProtocolHost } from '../testing/terminal-protocol-host.ts';
import { casesOn, runTerminalKit, type TerminalKitRun } from './terminal-kit.ts';

const BYTES = new TextEncoder().encode('the pinned program');
const PATH = join(tmpdir(), 'pins', 'terminal-host');

function kitRun(run: ProgramRunner, os: TerminalKitRun['os'] = undefined): TerminalKitRun {
  return {
    pin: { path: PATH, sha256: sha256Of(BYTES), args: [] },
    read: async (path) => (path === PATH ? BYTES : undefined),
    programs: { stage: async (_bytes, sha256, name) => join(tmpdir(), 'staged', sha256, name), run },
    env: {},
    os,
    runId: 'run-1',
  };
}

describe('runTerminalKit', () => {
  it('passes every case of a terminal that keeps its promises, each case in a kit world of its own, and finds no leak', async () => {
    const program = terminalProgram(referenceTerminal);
    const report = await runTerminalKit(kitRun(program.run));
    assert.deepEqual(
      report.cases.filter((one) => one.outcome.kind !== 'passed'),
      [],
    );
    assert.equal(report.cases.length, TERMINAL_CONTRACT.cases.length);
    assert.deepEqual(report.skipped, []);
    assert.deepEqual(report.leaks, []);
    assert.deepEqual(
      program.worlds,
      TERMINAL_CONTRACT.cases.map((_one, index) => `run-1-${index + 1}`),
    );
  });

  it('fails a terminal that says yes to everything', async () => {
    const report = await runTerminalKit(kitRun(terminalProgram(yesTerminal).run));
    assert.ok(report.cases.some((one) => one.outcome.kind === 'failed'));
  });

  it('runs every case on an operating system each case holds on', async () => {
    const report = await runTerminalKit(kitRun(terminalProgram(referenceTerminal).run, 'linux'));
    assert.equal(report.cases.length + report.skipped.length, TERMINAL_CONTRACT.cases.length);
  });

  it('names each kit request a program serves when started without kit mode', async () => {
    const { port, world } = referenceTerminal();
    const leaky = terminalProtocolHost(port, world);
    const run: ProgramRunner = async (request) => ({ end: { kind: 'exited', code: 0 }, stdout: await leaky(request.input ?? ''), stderr: '' });
    const report = await runTerminalKit(kitRun(run));
    assert.deepEqual(
      report.leaks.map((leak) => leak.method),
      ['kit.panes', 'kit.front', 'kit.put', 'kit.openByHand', 'kit.wakes', 'kit.restarts'],
    );
  });

  it('fails every case of a pin whose file is gone, with why', async () => {
    const report = await runTerminalKit({ ...kitRun(terminalProgram(referenceTerminal).run), read: async () => undefined });
    assert.ok(report.cases.length > 0);
    assert.ok(report.cases.every((one) => one.outcome.kind === 'failed'));
  });
});

describe('casesOn', () => {
  const caseOn = (id: string, os: readonly Os[]): BoundCase => ({ id, title: id, features: [], os, run: async () => {} });
  const cases = [caseOn('every', OSES), caseOn('windows-only', ['windows']), caseOn('posix', ['linux', 'macos'])];

  it('runs only the cases of the operating system it is on, and names the rest skipped', () => {
    const { runs, skipped } = casesOn(cases, 'linux');
    assert.deepEqual(runs.map((one) => one.id), ['every', 'posix']);
    assert.deepEqual(skipped, ['windows-only']);
  });

  it('runs every case on an operating system no proof is made on', () => {
    const { runs, skipped } = casesOn(cases, undefined);
    assert.deepEqual(runs.map((one) => one.id), ['every', 'windows-only', 'posix']);
    assert.deepEqual(skipped, []);
  });
});
