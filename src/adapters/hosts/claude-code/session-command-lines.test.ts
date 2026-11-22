import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RunningProgram } from '../../../plugin-api/index.ts';
import { backgroundJobSession, isForkOf } from './session-command-lines.ts';
import { sessionLauncher } from './session-launcher.ts';

/** A process of a lineage by its command line; the name plays no part in the reading. */
function running(commandLine: string): RunningProgram {
  return { name: 'claude', commandLine };
}

describe('isForkOf', () => {
  it('reads a fork resumed from the session or its transcript, in any flag spelling', () => {
    assert.ok(isForkOf('claude --fork-session --resume c0', 'c0'));
    assert.ok(isForkOf('claude --fork-session -r c0', 'c0'));
    assert.ok(isForkOf('claude --fork-session --resume=/p/c0.jsonl', 'c0'));
    assert.ok(isForkOf('claude\0--fork-session\0--resume\0/p/c0.jsonl', 'c0'));
  });

  it('is false without a fork flag, for another session, or for an empty command line', () => {
    assert.ok(!isForkOf('claude --resume c0', 'c0'));
    assert.ok(!isForkOf('claude --fork-session --resume c1', 'c0'));
    assert.ok(!isForkOf('claude --fork-session', 'c0'));
    assert.ok(!isForkOf('', 'c0'));
  });
});

describe('backgroundJobSession', () => {
  const host = 'claude bg-pty-host --bg-pty-host /s.sock 77 25 -- claude --session-id host-session';

  it("names the session of the job's background host, else the job's own", () => {
    assert.equal(backgroundJobSession([running('claude'), running(host)]), 'host-session');
    assert.equal(backgroundJobSession([running('claude --session-id=own'), running('x --bg-pty-host /s.sock')]), 'own');
  });

  it('is undefined for a process no background host runs, a host beyond its hops, or a job naming no session', () => {
    assert.equal(backgroundJobSession([running('claude --session-id own'), running('bash')]), undefined);
    assert.equal(backgroundJobSession([running('claude'), running('a'), running('b'), running(host)]), undefined);
    assert.equal(backgroundJobSession([running('claude'), running('x --bg-pty-host /s.sock')]), undefined);
    assert.equal(backgroundJobSession([]), undefined);
  });
});

describe("Claude Code's session launcher", () => {
  it('reads a fork and a background job by the readers above', () => {
    const launcher = sessionLauncher({});
    assert.equal(launcher.isForkOf, isForkOf);
    assert.equal(launcher.backgroundJobSession, backgroundJobSession);
  });
});
