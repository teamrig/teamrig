import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256Of } from '../../adapters/terminals/protocol/spawn.ts';
import type { TerminalPrograms } from '../../composition/terminal-kit.ts';
import { referenceTerminal, TERMINAL_CONTRACT, yesTerminal } from '../../conformance/index.ts';
import type { ProgramRunner } from '../../plugin-api/index.ts';
import { CliHarness } from '../../testing/cli-harness.ts';
import { terminalProgram, terminalProtocolHost } from '../../testing/terminal-protocol-host.ts';
import { EXIT } from '../runtime.ts';

const PROGRAM = join(tmpdir(), 'pins', 'terminal-host');
const CONTENT = 'the pinned program';
const SHA = sha256Of(new TextEncoder().encode(CONTENT));

function programs(run: ProgramRunner): TerminalPrograms {
  return { stage: async (_bytes, sha256, name) => join(tmpdir(), 'staged', sha256, name), run };
}

async function harnessWithProgram(): Promise<CliHarness> {
  const harness = new CliHarness();
  await harness.files.write(PROGRAM, CONTENT);
  return harness;
}

describe('teamrig conformance terminal', () => {
  it('passes every case of a terminal that keeps its promises and exits 0', async () => {
    const harness = await harnessWithProgram();
    const result = await harness.run(['conformance', 'terminal', '--program', PROGRAM, '--sha256', SHA], { terminalPrograms: programs(terminalProgram(referenceTerminal).run) });
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    const passed = result.stdout.filter((line) => line.startsWith('PASS '));
    const skipped = result.stdout.filter((line) => line.startsWith('SKIP '));
    assert.equal(passed.length + skipped.length, TERMINAL_CONTRACT.cases.length);
    assert.equal(result.stdout.at(-1), `${passed.length} of ${passed.length} cases passed, 0 kit request(s) served outside kit mode`);
  });

  it('passes the program its --args, split at commas', async () => {
    const harness = await harnessWithProgram();
    const seen: (readonly string[])[] = [];
    const program = terminalProgram(referenceTerminal);
    const run: ProgramRunner = async (request) => {
      seen.push(request.args);
      return await program.run(request);
    };
    const result = await harness.run(['conformance', 'terminal', '--program', PROGRAM, '--sha256', SHA, '--args', 'serve,--quiet'], { terminalPrograms: programs(run) });
    assert.equal(result.code, EXIT.ok, result.stdout.join('\n'));
    assert.ok(seen.length > 0);
    assert.ok(seen.every((args) => args.join(' ') === 'serve --quiet'));
  });

  it('prints a FAIL line with why for a terminal that says yes to everything, and exits 1', async () => {
    const harness = await harnessWithProgram();
    const result = await harness.run(['conformance', 'terminal', '--program', PROGRAM, '--sha256', SHA], { terminalPrograms: programs(terminalProgram(yesTerminal).run) });
    assert.equal(result.code, EXIT.failed);
    assert.ok(result.stdout.some((line) => /^FAIL [\w.-]+: \S/.test(line)), result.stdout.join('\n'));
  });

  it('prints a LEAK line for each kit request served outside kit mode, and exits 1', async () => {
    const harness = await harnessWithProgram();
    const { port, world } = referenceTerminal();
    const leaky = terminalProtocolHost(port, world);
    const run: ProgramRunner = async (request) => ({ end: { kind: 'exited', code: 0 }, stdout: await leaky(request.input ?? ''), stderr: '' });
    const result = await harness.run(['conformance', 'terminal', '--program', PROGRAM, '--sha256', SHA], { terminalPrograms: programs(run) });
    assert.equal(result.code, EXIT.failed);
    assert.ok(result.stdout.some((line) => line.startsWith('LEAK kit.panes: served outside kit mode')), result.stdout.join('\n'));
  });

  it('fails every case when the file is not the pinned bytes', async () => {
    const harness = new CliHarness();
    await harness.files.write(PROGRAM, 'another program');
    const result = await harness.run(['conformance', 'terminal', '--program', PROGRAM, '--sha256', SHA], { terminalPrograms: programs(terminalProgram(referenceTerminal).run) });
    assert.equal(result.code, EXIT.failed);
    assert.equal(result.stdout.filter((line) => line.startsWith('PASS ')).length, 0);
  });

  for (const [why, argv] of [
    ['no --program', ['--sha256', SHA]],
    ['no --sha256', ['--program', PROGRAM]],
    ['a relative --program', ['--program', 'terminal-host', '--sha256', SHA]],
    ['a --sha256 that is not 64 lowercase hex', ['--program', PROGRAM, '--sha256', SHA.toUpperCase()]],
  ] as const) {
    it(`refuses ${why} as a usage error, running nothing`, async () => {
      const harness = await harnessWithProgram();
      let ran = 0;
      const run: ProgramRunner = async () => {
        ran += 1;
        return { end: { kind: 'exited', code: 0 }, stdout: '', stderr: '' };
      };
      const result = await harness.run(['conformance', 'terminal', ...argv], { terminalPrograms: programs(run) });
      assert.equal(result.code, EXIT.usage);
      assert.match([...result.stdout, ...result.stderr].join('\n'), /usage: teamrig conformance terminal/);
      assert.equal(ran, 0);
    });
  }
});
