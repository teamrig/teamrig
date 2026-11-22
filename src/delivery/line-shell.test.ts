import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lineShellOf, powerShellSpec, type LineShellSpec } from './line-shell.ts';

/**
 * A line shell made of Node, so the specs run on every OS: `say <text>` prints the text, `mark <m>` prints m alone,
 * `hang` stops reading (the marker after it never prints), `quit` exits, `flood` prints past any cap, and anything else prints `ran <line>`.
 */
const PROGRAM = `
let pending = '';
let hung = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  if (hung) return;
  pending += chunk;
  let at;
  while (!hung && (at = pending.indexOf('\\n')) >= 0) {
    const line = pending.slice(0, at);
    pending = pending.slice(at + 1);
    if (line.startsWith('mark ')) process.stdout.write(line.slice(5) + '\\r\\n');
    else if (line.startsWith('say ')) process.stdout.write(line.slice(4) + '\\r\\n');
    else if (line === 'hang') hung = true;
    else if (line === 'quit') process.exit(3);
    else if (line === 'flood') process.stdout.write('x'.repeat(4096));
    else process.stdout.write('ran ' + line + '\\r\\n');
  }
});
`;

function nodeShell(timeoutMs = 5_000, maxBytes = 1_024): LineShellSpec {
  return { file: process.execPath, args: ['-e', PROGRAM], echo: (marker) => `mark ${marker}`, timeoutMs, maxBytes };
}

describe('lineShellOf', () => {
  it('runs each script in the one shell and settles with what that script alone printed', async () => {
    const shell = lineShellOf(nodeShell());
    try {
      const outputs = await Promise.all([shell.run('say one'), shell.run('say two'), shell.run('pid')]);
      assert.deepEqual(outputs.slice(0, 2), ['one\r\n', 'two\r\n']);
      assert.equal(outputs[2], 'ran pid\r\n');
    } finally {
      shell.close();
    }
  });

  it('settles a hung script with nothing at its time limit, and starts a fresh shell for the next one', async () => {
    // The limit covers the fresh shell's start too, which takes Node well over 300 ms on a loaded host.
    const shell = lineShellOf(nodeShell(2_000));
    try {
      assert.equal(await shell.run('hang'), undefined);
      assert.equal(await shell.run('say back'), 'back\r\n');
    } finally {
      shell.close();
    }
  });

  it('settles with nothing when the shell exits mid-script, and the next script still runs', async () => {
    const shell = lineShellOf(nodeShell());
    try {
      assert.equal(await shell.run('quit'), undefined);
      assert.equal(await shell.run('say again'), 'again\r\n');
    } finally {
      shell.close();
    }
  });

  it('settles with nothing past its byte cap', async () => {
    const shell = lineShellOf(nodeShell(5_000, 1_024));
    try {
      assert.equal(await shell.run('flood'), undefined);
    } finally {
      shell.close();
    }
  });

  it('settles with nothing, sending nothing, for a script holding a line break', async () => {
    // Sent, the shell would print both lines before the marker, and the run would settle with them.
    const shell = lineShellOf(nodeShell());
    try {
      assert.equal(await shell.run('say a\nsay b'), undefined);
      assert.equal(await shell.run('say c'), 'c\r\n');
    } finally {
      shell.close();
    }
  });

  it('settles with nothing when the shell cannot start', async () => {
    const shell = lineShellOf({ ...nodeShell(), file: 'teamrig-no-such-shell' });
    assert.equal(await shell.run('say hi'), undefined);
    shell.close();
  });

  it('settles a script still waiting when the shell is closed', async () => {
    const shell = lineShellOf(nodeShell());
    const waiting = shell.run('hang');
    // The run waits on the queue's tail first; let it reach the shell before the close.
    await new Promise((resolve) => setImmediate(resolve));
    shell.close();
    assert.equal(await waiting, undefined);
  });
});

describe('powerShellSpec', () => {
  it('reads commands from standard input and echoes the marker as a string', () => {
    const spec = powerShellSpec(30_000, 100);
    assert.equal(spec.file, 'powershell.exe');
    assert.deepEqual(spec.args, ['-NoProfile', '-NonInteractive', '-Command', '-']);
    assert.equal(spec.echo('done-1'), "'done-1'");
    assert.deepEqual([spec.timeoutMs, spec.maxBytes], [30_000, 100]);
  });
});
