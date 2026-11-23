import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { systemCredentials, windowsReadFirstScript, windowsReadScript } from './credentials.ts';
import type { ProgramRequest, ProgramResult, ProgramRunner } from './program-runner.ts';

const NAME = 'teamrig-gh-acme';
const TOKEN = 'tok-acme';

/** A runner that answers every run with `result` and records each request. */
function answering(result: ProgramResult): { readonly run: ProgramRunner; readonly ran: ProgramRequest[] } {
  const ran: ProgramRequest[] = [];
  return {
    ran,
    run: async (request) => {
      ran.push(request);
      return result;
    },
  };
}

function exited(code: number, stdout = '', stderr = ''): ProgramResult {
  return { end: { kind: 'exited', code }, stdout, stderr };
}

/** A runner whose program cannot start, as `spawn` fails with `code`. */
function notStarting(code: string): ProgramRunner {
  return async (request) => {
    throw Object.assign(new Error(`spawn ${request.program} ${code}`), { code });
  };
}

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

describe('systemCredentials on Windows', () => {
  it('reads the credential through a PowerShell script passed encoded, never the secret in an argument', async () => {
    const runner = answering(exited(0, `${base64(TOKEN)}\r\n`));
    const store = systemCredentials('win32', runner.run);
    assert.deepEqual(await store.read(NAME), { kind: 'found', secret: TOKEN });
    const [request] = runner.ran;
    assert.equal(request?.program, 'powershell.exe');
    assert.deepEqual(request?.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    assert.equal(Buffer.from(request?.args[3] ?? '', 'base64').toString('utf16le'), windowsReadScript(NAME));
    assert.ok(windowsReadScript(NAME).includes(`::Read('${NAME}')`));
  });

  it('says how to save one, and that none is saved when the script ends with 3', async () => {
    const store = systemCredentials('win32', answering(exited(3)).run);
    assert.equal(store.label, 'the Windows Credential Manager');
    assert.equal(store.saveCommand(NAME), `cmdkey /generic:${NAME} /user:teamrig /pass`);
    assert.deepEqual(await store.read(NAME), { kind: 'missing' });
  });

  it('gives a failure by its first error line, and a stop by its signal', async () => {
    const failed = systemCredentials('win32', answering(exited(1, '', '\nAdd-Type : boom\nat line 2\n')).run);
    assert.deepEqual(await failed.read(NAME), { kind: 'failed', reason: 'powershell.exe exited 1: Add-Type : boom' });
    const stopped = systemCredentials('win32', answering({ end: { kind: 'signal', signal: 'SIGTERM' }, stdout: '', stderr: '' }).run);
    assert.deepEqual(await stopped.read(NAME), { kind: 'failed', reason: 'powershell.exe was stopped (SIGTERM): no error text' });
  });

  it('refuses a saved value that is not a token, without printing it', async () => {
    const read = await systemCredentials('win32', answering(exited(0, base64('two words'))).run).read(NAME);
    assert.deepEqual(read, { kind: 'failed', reason: `credential ${NAME} does not hold a token: save it again with cmdkey /generic:${NAME} /user:teamrig /pass` });
  });
});

describe('systemCredentials readFirst on Windows', () => {
  const NARROW = 'teamrig-gh-acme.web';

  it('reads every name in one PowerShell run, in order, and gives the first saved by its place', async () => {
    const runner = answering(exited(0, `1 ${base64(TOKEN)}\r\n`));
    assert.deepEqual(await systemCredentials('win32', runner.run).readFirst([NARROW, NAME]), { kind: 'found', index: 1, secret: TOKEN });
    assert.equal(runner.ran.length, 1);
    const script = windowsReadFirstScript([NARROW, NAME]);
    assert.equal(Buffer.from(runner.ran[0]?.args[3] ?? '', 'base64').toString('utf16le'), script);
    assert.ok(script.includes(`$names = @('${NARROW}', '${NAME}')`));
  });

  it('says none is saved when the run ends with 3', async () => {
    assert.deepEqual(await systemCredentials('win32', answering(exited(3)).run).readFirst([NARROW, NAME]), { kind: 'missing' });
  });

  it('fails at the first name when the run fails or answers what teamrig does not read, so no wider key stands in', async () => {
    assert.deepEqual(await systemCredentials('win32', answering(exited(1, '', 'Add-Type : boom\n')).run).readFirst([NARROW, NAME]), {
      kind: 'failed',
      index: 0,
      reason: 'powershell.exe exited 1: Add-Type : boom',
    });
    for (const stdout of ['', 'two words', `2 ${base64(TOKEN)}`]) {
      assert.deepEqual(await systemCredentials('win32', answering(exited(0, stdout)).run).readFirst([NARROW, NAME]), {
        kind: 'failed',
        index: 0,
        reason: 'powershell.exe gave no answer teamrig reads',
      });
    }
    assert.deepEqual(await systemCredentials('win32', notStarting('ENOENT')).readFirst([NAME]), {
      kind: 'failed',
      index: 0,
      reason: 'powershell.exe could not start: spawn powershell.exe ENOENT',
    });
  });

  it('refuses a saved value that is not a token at its place', async () => {
    assert.deepEqual(await systemCredentials('win32', answering(exited(0, `1 ${base64('two words')}`)).run).readFirst([NARROW, NAME]), {
      kind: 'failed',
      index: 1,
      reason: `credential ${NAME} does not hold a token: save it again with cmdkey /generic:${NAME} /user:teamrig /pass`,
    });
  });

  it('reads only the names before one that is no credential name, and fails there when none of them is saved', async () => {
    const runner = answering(exited(3));
    assert.deepEqual(await systemCredentials('win32', runner.run).readFirst([NARROW, "acme'; rm", NAME]), {
      kind: 'failed',
      index: 1,
      reason: `"acme'; rm" is not a credential name: letters, digits, '.', '_' or '-'`,
    });
    assert.equal(Buffer.from(runner.ran[0]?.args[3] ?? '', 'base64').toString('utf16le'), windowsReadFirstScript([NARROW]));
    const none = answering(exited(3));
    assert.equal((await systemCredentials('win32', none.run).readFirst(["'"])).kind, 'failed');
    assert.deepEqual(none.ran, []);
  });
});

describe('systemCredentials readFirst on macOS and Linux', () => {
  it('reads one name at a time, stopping at the first saved', async () => {
    const runner = answering(exited(0, `${TOKEN}\n`));
    assert.deepEqual(await systemCredentials('linux', runner.run).readFirst([NAME, 'teamrig-gh-globex']), { kind: 'found', index: 0, secret: TOKEN });
    assert.deepEqual(runner.ran, [{ program: 'secret-tool', args: ['lookup', 'service', NAME] }]);
    assert.deepEqual(await systemCredentials('darwin', answering(exited(44)).run).readFirst([NAME]), { kind: 'missing' });
  });
});

describe('systemCredentials on macOS', () => {
  it('reads the keychain item by service name, and exit 44 means none is saved', async () => {
    const runner = answering(exited(0, `${TOKEN}\n`));
    const store = systemCredentials('darwin', runner.run);
    assert.deepEqual(await store.read(NAME), { kind: 'found', secret: TOKEN });
    assert.deepEqual(runner.ran, [{ program: 'security', args: ['find-generic-password', '-s', NAME, '-w'] }]);
    assert.equal(store.saveCommand(NAME), `security add-generic-password -U -s ${NAME} -a teamrig -w`);
    assert.deepEqual(await systemCredentials('darwin', answering(exited(44, '', 'could not be found')).run).read(NAME), { kind: 'missing' });
  });
});

describe('systemCredentials on Linux', () => {
  it('reads the Secret Service item by its service attribute', async () => {
    const runner = answering(exited(0, `${TOKEN}\n`));
    const store = systemCredentials('linux', runner.run);
    assert.deepEqual(await store.read(NAME), { kind: 'found', secret: TOKEN });
    assert.deepEqual(runner.ran, [{ program: 'secret-tool', args: ['lookup', 'service', NAME] }]);
    assert.equal(store.saveCommand(NAME), `secret-tool store --label=${NAME} service ${NAME}`);
  });

  it('takes a silent exit 1 or no secret-tool as none saved, and an error text as a failure', async () => {
    assert.deepEqual(await systemCredentials('linux', answering(exited(1)).run).read(NAME), { kind: 'missing' });
    assert.deepEqual(await systemCredentials('linux', notStarting('ENOENT')).read(NAME), { kind: 'missing' });
    assert.deepEqual(await systemCredentials('linux', answering(exited(1, '', 'Cannot autolaunch D-Bus without X11\n')).run).read(NAME), {
      kind: 'failed',
      reason: 'secret-tool exited 1: Cannot autolaunch D-Bus without X11',
    });
    assert.deepEqual(await systemCredentials('linux', notStarting('EACCES')).read(NAME), {
      kind: 'failed',
      reason: 'secret-tool could not start: spawn secret-tool EACCES',
    });
  });
});

describe('credential names', () => {
  it('refuses a name that would need quoting, without running anything', async () => {
    const runner = answering(exited(0, TOKEN));
    assert.deepEqual(await systemCredentials('linux', runner.run).read("acme'; rm"), {
      kind: 'failed',
      reason: `"acme'; rm" is not a credential name: letters, digits, '.', '_' or '-'`,
    });
    assert.deepEqual(runner.ran, []);
  });
});
