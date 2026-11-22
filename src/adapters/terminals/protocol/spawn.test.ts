import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProgramOutputCapError, type Env, type ProgramRequest, type ProgramResult } from '../../../plugin-api/index.ts';
import { pinnedTransport, pinProblem, sha256Of, shortEnv, PROTOCOL_OUTPUT_CAP_BYTES, type PinnedRunPorts, type ProgramPin } from './spawn.ts';

const PROGRAM = join(tmpdir(), 'pins', 'terminal-host');
const BYTES = new TextEncoder().encode('the pinned program');
const PIN: ProgramPin = { path: PROGRAM, sha256: sha256Of(BYTES), args: ['--serve'] };
const LINE = '{"jsonrpc":"2.0","id":1,"method":"capabilities","params":{}}\n';
const OK: ProgramResult = { end: { kind: 'exited', code: 0 }, stdout: '{"answer":1}\n', stderr: '' };

interface Recorded {
  readonly ports: PinnedRunPorts;
  readonly reads: string[];
  readonly staged: (readonly [sha256: string, name: string])[];
  readonly runs: ProgramRequest[];
}

/** Ports over one file, `bytes` at `PROGRAM` unless undefined, each run answered by `run`; every call is recorded. */
function portsOf(options: { readonly bytes?: Uint8Array | undefined; readonly run?: (request: ProgramRequest) => Promise<ProgramResult>; readonly env?: Env; readonly stage?: () => Promise<string> } = {}): Recorded {
  const reads: string[] = [];
  const staged: (readonly [string, string])[] = [];
  const runs: ProgramRequest[] = [];
  const bytes = 'bytes' in options ? options.bytes : BYTES;
  const ports: PinnedRunPorts = {
    read: async (path) => {
      reads.push(path);
      return path === PROGRAM ? bytes : undefined;
    },
    stage: async (_bytes, sha256, name) => {
      staged.push([sha256, name]);
      return options.stage === undefined ? join(tmpdir(), 'staged', sha256, name) : options.stage();
    },
    run: async (request) => {
      runs.push(request);
      return options.run === undefined ? OK : options.run(request);
    },
    env: options.env ?? {},
  };
  return { ports, reads, staged, runs };
}

describe('pinProblem', () => {
  it('passes an absolute path with a sha256', () => {
    assert.equal(pinProblem(PIN), undefined);
  });

  it('refuses a relative path, which the working folder or a search path would resolve', () => {
    assert.match(pinProblem({ ...PIN, path: 'terminal-host' }) ?? '', /is not an absolute path/);
  });

  it('refuses a pin with no sha256 of 64 lowercase hex characters', () => {
    assert.match(pinProblem({ ...PIN, sha256: PIN.sha256.toUpperCase() }) ?? '', /holds no sha256/);
    assert.match(pinProblem({ ...PIN, sha256: '' }) ?? '', /holds no sha256/);
  });
});

describe('shortEnv', () => {
  it('passes only the short names, matched without case, under their own spelling', () => {
    const env = shortEnv({ Path: '/bin', HOME: '/h', LANG: 'C', GH_TOKEN: 'key', TEAMRIG_GITHUB_TOKEN: 'key', NODE_OPTIONS: '--require x', TEMP: undefined });
    assert.deepEqual(env, { Path: '/bin', HOME: '/h', LANG: 'C' });
  });
});

describe('pinnedTransport', () => {
  it('runs the staged copy of the checked bytes with the pinned arguments, the line on stdin and the short env', async () => {
    const recorded = portsOf({ env: { PATH: '/bin', GH_TOKEN: 'key' } });
    const answer = await pinnedTransport(PIN, recorded.ports)(LINE);
    assert.deepEqual(answer, { kind: 'answered', output: OK.stdout });
    assert.deepEqual(recorded.staged, [[PIN.sha256, 'terminal-host']]);
    assert.deepEqual(recorded.runs, [{ program: join(tmpdir(), 'staged', PIN.sha256, 'terminal-host'), args: ['--serve'], env: { PATH: '/bin' }, input: LINE }]);
  });

  it('reads and checks the file again on every request', async () => {
    const recorded = portsOf();
    const transport = pinnedTransport(PIN, recorded.ports);
    await transport(LINE);
    await transport(LINE);
    assert.deepEqual(recorded.reads, [PROGRAM, PROGRAM]);
  });

  it('never runs a file whose bytes no longer match the pin, and names its new sha256', async () => {
    const changed = new TextEncoder().encode('an updated program');
    const recorded = portsOf({ bytes: changed });
    const answer = await pinnedTransport(PIN, recorded.ports)(LINE);
    assert.deepEqual(answer, { kind: 'failed', why: `the terminal program ${PROGRAM} no longer matches its pin (its sha256 is now ${sha256Of(changed)}), so teamrig does not run it until the owner pins it again` });
    assert.deepEqual([recorded.staged, recorded.runs], [[], []]);
  });

  it('fails a pin it cannot run without reading the file', async () => {
    const recorded = portsOf();
    const answer = await pinnedTransport({ ...PIN, path: 'terminal-host' }, recorded.ports)(LINE);
    assert.equal(answer.kind, 'failed');
    assert.deepEqual(recorded.reads, []);
  });

  it('fails a program that is not there', async () => {
    const answer = await pinnedTransport(PIN, portsOf({ bytes: undefined }).ports)(LINE);
    assert.deepEqual(answer, { kind: 'failed', why: `the terminal program ${PROGRAM} is not there` });
  });

  it('fails, without running, when the copy cannot be made', async () => {
    const recorded = portsOf({ stage: () => Promise.reject(new Error('disk full')) });
    const answer = await pinnedTransport(PIN, recorded.ports)(LINE);
    assert.deepEqual(answer, { kind: 'failed', why: `teamrig could not read or copy the terminal program ${PROGRAM}: disk full` });
    assert.deepEqual(recorded.runs, []);
  });

  it('fails a run that exits non-zero, quoting the first line of its stderr', async () => {
    const run = async (): Promise<ProgramResult> => ({ end: { kind: 'exited', code: 2 }, stdout: '', stderr: '\nno window\x1b[2J here\nmore' });
    const answer = await pinnedTransport(PIN, portsOf({ run }).ports)(LINE);
    assert.equal(answer.kind, 'failed');
    assert.match(answer.kind === 'failed' ? answer.why : '', /exited with code 2: no window.*here$/);
    assert.doesNotMatch(answer.kind === 'failed' ? answer.why : '', /\x1b|more/);
  });

  it('fails a run that exits non-zero with no stderr by its code alone', async () => {
    const run = async (): Promise<ProgramResult> => ({ end: { kind: 'exited', code: 3 }, stdout: '', stderr: '' });
    const answer = await pinnedTransport(PIN, portsOf({ run }).ports)(LINE);
    assert.deepEqual(answer, { kind: 'failed', why: `the terminal program ${PROGRAM} exited with code 3` });
  });

  it('fails a run stopped by a signal, as one past its time limit', async () => {
    const run = async (): Promise<ProgramResult> => ({ end: { kind: 'signal', signal: 'SIGTERM' }, stdout: '{"partial"', stderr: '' });
    const answer = await pinnedTransport(PIN, portsOf({ run }).ports)(LINE);
    assert.deepEqual(answer, { kind: 'failed', why: `the terminal program ${PROGRAM} was stopped by SIGTERM, as when it outlives its time limit` });
  });

  it('fails a run that printed past its cap and uses none of it', async () => {
    const run = (): Promise<ProgramResult> => Promise.reject(new ProgramOutputCapError(PROGRAM, PROTOCOL_OUTPUT_CAP_BYTES));
    const answer = await pinnedTransport(PIN, portsOf({ run }).ports)(LINE);
    assert.deepEqual(answer, { kind: 'failed', why: `the terminal program ${PROGRAM} printed more than ${PROTOCOL_OUTPUT_CAP_BYTES} bytes, so teamrig stopped it and used none of it` });
  });

  it('fails a run that would not start, quoting why', async () => {
    const run = (): Promise<ProgramResult> => Promise.reject(new Error('spawn EACCES'));
    const answer = await pinnedTransport(PIN, portsOf({ run }).ports)(LINE);
    assert.deepEqual(answer, { kind: 'failed', why: `the terminal program ${PROGRAM} would not start: spawn EACCES` });
  });

  it('quotes a thrown value that is not an Error', async () => {
    const run = (): Promise<ProgramResult> => Promise.reject('gone');
    const answer = await pinnedTransport(PIN, portsOf({ run }).ports)(LINE);
    assert.deepEqual(answer, { kind: 'failed', why: `the terminal program ${PROGRAM} would not start: gone` });
  });
});
