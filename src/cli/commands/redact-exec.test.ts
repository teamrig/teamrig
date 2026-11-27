import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { constants } from 'node:os';
import { join } from 'node:path';
import { encodePrompt } from '../../open/prompt.ts';
import { readEvents } from '../../register/snapshot.ts';
import { APP, CLAUDE_SESSION, CliHarness, EVENTS_PATH, TEAM, TEAM_HOME, contextOf, decisionOf } from '../../testing/cli-harness.ts';

const FAKE_TOKEN = ['ghp', '_1234567890abcdefghijklmnopqrstuvwxyz'].join('');
const INCIDENTS = join(TEAM_HOME, 'state', 'secret-incidents.jsonl');
const REVIEWED = { ...TEAM, roles: { lead: 'lead', securityReviewer: 'bravo' } };

function bashHookStdin(command: string): string {
  return JSON.stringify({
    session_id: CLAUDE_SESSION,
    cwd: APP,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  });
}

describe('teamrig redact-exec', () => {
  it('loads config before running the command even if the command rewrites it, and passes clean output through', async () => {
    const harness = new CliHarness();
    const res = await harness.run(['redact-exec', '--', 'env'], {
      shell: {
        run: async () => {
          await harness.files.write(join(TEAM_HOME, 'config.json'), JSON.stringify({ ...TEAM, secretGuard: { redact: false } }));
          return { end: { kind: 'exited', code: 0 }, output: `token=${FAKE_TOKEN}\n` };
        },
      },
    });
    assert.equal(res.code, 0);
    assert.equal(res.stdout[0]?.includes(FAKE_TOKEN), false);
    assert.match(res.stdout[0] ?? '', /\[redacted /);

    const clean = await new CliHarness().run(['redact-exec', '--', 'echo', 'hello'], {
      shell: { run: async () => ({ end: { kind: 'exited', code: 0 }, output: 'hello world\n' }) },
    });
    assert.equal(clean.code, 0);
    assert.deepEqual(clean.stdout, ['hello world']);
    assert.deepEqual(clean.stderr, []);
  });

  it('files a rotation task on leak, names it on stderr, and never stores the secret value', async () => {
    const harness = new CliHarness(REVIEWED);
    const res = await harness.run(['redact-exec', '--session', 'alpha', '--', 'env'], {
      shell: { run: async () => ({ end: { kind: 'exited', code: 0 }, output: `token=${FAKE_TOKEN}\n` }) },
    });
    assert.equal(res.code, 0);
    assert.equal(res.stdout.length, 1);
    assert.equal(res.stdout[0]?.includes(FAKE_TOKEN), false);
    assert.match(res.stdout[0] ?? '', /\[redacted /);
    assert.match(res.stderr.at(-1) ?? '', /bravo rotates it in T1\./);

    const events = readEvents(harness.files.get(EVENTS_PATH) ?? '').events;
    assert.equal(events.some((e) => e.type === 'create' && e.id === 'T1' && e.task.owner === 'bravo'), true);
    for (const path of [EVENTS_PATH, INCIDENTS]) {
      assert.equal((harness.files.get(path) ?? '').includes(FAKE_TOKEN), false);
    }
  });

  it('produces the exact same redacted output as hook secret-redact for the same input', async () => {
    const line = `token=${FAKE_TOKEN}`;
    const execHarness = new CliHarness(REVIEWED);
    const execRes = await execHarness.run(['redact-exec', '--session', 'alpha', '--', 'env'], {
      shell: { run: async () => ({ end: { kind: 'exited', code: 0 }, output: `${line}\n` }) },
    });

    const hookHarness = new CliHarness(REVIEWED);
    const hookRes = await hookHarness.run(['hook', 'secret-redact'], {
      env: { TEAMRIG_SESSION: 'alpha' },
      stdin: JSON.stringify({
        session_id: CLAUDE_SESSION,
        cwd: APP,
        tool_name: 'Bash',
        tool_input: { command: 'env' },
        tool_response: { stdout: line, stderr: '', interrupted: false, isImage: false },
      }),
    });
    const parsedHook = JSON.parse(hookRes.stdout[0] ?? '{}');
    assert.equal(execRes.stdout[0], parsedHook.hookSpecificOutput.updatedToolOutput.stdout);
    assert.equal(execRes.stderr.at(-1), contextOf(hookRes));
  });

  it('preserves exact exit codes and maps signals to 128 + signal number', async () => {
    const harness = new CliHarness();
    const code2 = await harness.run(['redact-exec', '--', 'grep', 'x'], {
      shell: { run: async () => ({ end: { kind: 'exited', code: 2 }, output: '' }) },
    });
    assert.equal(code2.code, 2);

    const signaled = await harness.run(['redact-exec', '--', 'sleep', '10'], {
      shell: { run: async () => ({ end: { kind: 'signal', signal: 'SIGTERM' }, output: '' }) },
    });
    assert.equal(signaled.code, 128 + constants.signals.SIGTERM);

    const unknownSignal = await harness.run(['redact-exec', '--', 'sleep', '10'], {
      shell: { run: async () => ({ end: { kind: 'signal', signal: 'SIGUNKNOWN' }, output: '' }) },
    });
    assert.equal(unknownSignal.code, 128 + 15);
  });

  it('passes --shell to the shell runner and decodes --encoded-command', async () => {
    const harness = new CliHarness();
    let seenCommand = '';
    let seenShell: string | undefined;
    const encoded = encodePrompt('echo "hi" && git status');
    const res = await harness.run(['redact-exec', '--shell', 'bash', '--encoded-command', encoded], {
      shell: {
        run: async (req) => {
          seenCommand = req.command;
          seenShell = req.shell;
          return { end: { kind: 'exited', code: 0 }, output: 'ok\n' };
        },
      },
    });
    assert.equal(res.code, 0);
    assert.equal(seenCommand, 'echo "hi" && git status');
    assert.equal(seenShell, 'bash');

    const badShell = await harness.run(['redact-exec', '--shell', 'fish', '--', 'echo', 'hi']);
    assert.equal(badShell.code, 64);

    const badEncoded = await harness.run(['redact-exec', '--encoded-command', '!!!']);
    assert.equal(badEncoded.code, 64);

    const both = await harness.run(['redact-exec', '--encoded-command', encoded, '--', 'echo', 'hi']);
    assert.equal(both.code, 64);

    const bareDash = await harness.run(['redact-exec', '--encoded-command', encoded, '--']);
    assert.equal(bareDash.code, 64);

    const multiWordWithShell = await harness.run(['redact-exec', '--shell', 'powershell', '--', 'echo', 'hi'], { platform: 'win32' });
    assert.equal(multiWordWithShell.code, 64);
    assert.ok(multiWordWithShell.stderr.join('\n').includes('pass the command as one quoted word'));

    const emptyEncoded = await harness.run(['redact-exec', '--encoded-command', encodePrompt('   ')]);
    assert.equal(emptyEncoded.code, 64);
  });

  it('uses TEAMRIG_SESSION when --session is omitted and leaves output unredacted when secretGuard.redact is false', async () => {
    const envHarness = new CliHarness(REVIEWED);
    const envRes = await envHarness.run(['redact-exec', '--', 'env'], {
      env: { TEAMRIG_SESSION: 'alpha' },
      shell: { run: async () => ({ end: { kind: 'exited', code: 0 }, output: `token=${FAKE_TOKEN}\n` }) },
    });
    assert.match(envRes.stderr.at(-1) ?? '', /bravo rotates it in T1\./);

    const harness = new CliHarness({ ...TEAM, secretGuard: { redact: false } });
    const res = await harness.run(['redact-exec', '--', 'env'], {
      shell: { run: async () => ({ end: { kind: 'exited', code: 3 }, output: `token=${FAKE_TOKEN}\n` }) },
    });
    assert.equal(res.code, 3);
    assert.deepEqual(res.stdout, [`token=${FAKE_TOKEN}`]);
    assert.deepEqual(res.stderr, []);
  });

  it('guards look through teamrig redact-exec to the wrapped command', async () => {
    const harness = new CliHarness();
    const encodedPush = encodePrompt('git push --force origin main');
    const pushRes = await harness.run(['hook', 'push-guard'], { stdin: bashHookStdin(`teamrig redact-exec --encoded-command ${encodedPush}`) });
    assert.equal(decisionOf(pushRes), 'deny');

    const encodedBareDash = await harness.run(['hook', 'push-guard'], {
      stdin: bashHookStdin(`teamrig redact-exec --encoded-command ${encodedPush} --`),
    });
    assert.equal(decisionOf(encodedBareDash), 'deny');

    const secretRes = await harness.run(['hook', 'secret-guard'], { stdin: bashHookStdin('teamrig redact-exec -- cat .env') });
    assert.equal(decisionOf(secretRes), 'deny');

    const dbRes = await harness.run(['hook', 'db-write-guard'], { stdin: bashHookStdin('teamrig redact-exec -- psql -c "DELETE FROM users"') });
    assert.equal(decisionOf(dbRes), 'deny');

    const execRes = await harness.run(['hook', 'exec-guard'], {
      env: { TEAMRIG_SESSION: 'alpha' },
      stdin: bashHookStdin('teamrig redact-exec -- teamrig exec approve R1'),
    });
    assert.equal(decisionOf(execRes), 'deny');

    const dynShell = await harness.run(['hook', 'exec-guard'], {
      env: { TEAMRIG_SESSION: 'alpha' },
      stdin: bashHookStdin('teamrig redact-exec --shell "$S" -- echo ok'),
    });
    assert.equal(decisionOf(dynShell), 'deny');

    const dynShellEq = await harness.run(['hook', 'exec-guard'], {
      env: { TEAMRIG_SESSION: 'alpha' },
      stdin: bashHookStdin('teamrig redact-exec "--shell=$S" -- echo ok'),
    });
    assert.equal(decisionOf(dynShellEq), 'deny');

    const dynFlag = await harness.run(['hook', 'exec-guard'], {
      env: { TEAMRIG_SESSION: 'alpha' },
      stdin: bashHookStdin('teamrig redact-exec "$F" -- echo ok'),
    });
    assert.equal(decisionOf(dynFlag), 'deny');

    const dynEncoded = await harness.run(['hook', 'exec-guard'], {
      env: { TEAMRIG_SESSION: 'alpha' },
      stdin: bashHookStdin('teamrig redact-exec --encoded-command "$E"'),
    });
    assert.equal(decisionOf(dynEncoded), 'deny');

    const dynSep = await harness.run(['hook', 'exec-guard'], {
      env: { TEAMRIG_SESSION: 'alpha' },
      stdin: bashHookStdin('teamrig redact-exec "$SEP" echo ok'),
    });
    assert.equal(decisionOf(dynSep), 'deny');

    const psPush = await harness.run(['hook', 'push-guard'], {
      stdin: bashHookStdin('teamrig redact-exec --shell powershell -- "echo a; git push --force origin main"'),
    });
    assert.equal(decisionOf(psPush), 'deny');

    const bashPush = await harness.run(['hook', 'push-guard'], {
      stdin: bashHookStdin('teamrig redact-exec --shell bash -- "echo a; git push --force origin main"'),
    });
    assert.equal(decisionOf(bashPush), 'deny');

    const psMulti = await harness.run(['hook', 'push-guard'], {
      stdin: bashHookStdin('teamrig redact-exec --shell powershell -- git push --force origin main'),
    });
    assert.equal(decisionOf(psMulti), 'deny');

    const bashMulti = await harness.run(['hook', 'push-guard'], {
      stdin: bashHookStdin('teamrig redact-exec --shell bash -- git push --force origin main'),
    });
    assert.equal(decisionOf(bashMulti), 'deny');

    const execMulti = await harness.run(['hook', 'exec-guard'], {
      env: { TEAMRIG_SESSION: 'alpha' },
      stdin: bashHookStdin('teamrig redact-exec --shell powershell -- echo ok'),
    });
    assert.equal(decisionOf(execMulti), 'deny');

    const afterDash = await harness.run(['hook', 'exec-guard'], {
      env: { TEAMRIG_SESSION: 'alpha' },
      stdin: bashHookStdin('teamrig redact-exec -- echo --shell "$S"'),
    });
    assert.equal(decisionOf(afterDash), undefined);
  });
});
