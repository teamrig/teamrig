import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRecord, recordField, stringField, type JsonRecord } from '../core/guards.ts';
import { hookEventOf, replyText } from '../testing/host.ts';
import { installGuardReply, segmentPattern, type GuardedPlace, type InstallGuardEnv } from './install-guard.ts';

const KIT: GuardedPlace = {
  folder: 'C:/u/.teamrig',
  entries: ['versions', 'bin', 'current', 'current.json', 'installs.json'],
  what: 'the teamrig install',
  writer: 'run `teamrig` from PATH',
};

const CODEX: GuardedPlace = {
  folder: 'C:/u/.codex',
  entries: ['hooks.json', 'config.toml'],
  what: "Codex CLI's hook files",
  writer: '`teamrig setup hooks`',
};

/** A path's spelling as the fake filesystem keys it: one slash, any case. */
function fileKey(path: string): string {
  return path.replaceAll('\\', '/').toLowerCase();
}

/** The real path of each spelling the fake filesystem knows; a short name comes back unchanged, as Node gives it. */
const REAL: Readonly<Record<string, string>> = {
  [fileKey('C:/')]: 'C:/',
  [fileKey('C:/u')]: 'C:/u',
  [fileKey('C:/w')]: 'C:/w',
  [fileKey('C:/u/.teamrig')]: 'C:/u/.teamrig',
  [fileKey('C:/u/TEAMRI~1')]: 'C:/u/TEAMRI~1',
  [fileKey('C:/u/.teamrig/teams')]: 'C:/u/.teamrig/teams',
  [fileKey('C:/u/.codex')]: 'C:/u/.codex',
  [fileKey('C:/w/kit')]: 'C:/u/.teamrig',
};

interface GuardOptions {
  readonly platform?: NodeJS.Platform;
  readonly places?: readonly GuardedPlace[];
  readonly variables?: Readonly<Record<string, string | undefined>>;
}

function env(options: GuardOptions = {}): InstallGuardEnv {
  return {
    cwd: 'C:/w',
    home: options.platform === 'linux' ? '/srv/u' : 'C:/u',
    platform: options.platform ?? 'win32',
    variables: options.variables ?? { USERPROFILE: 'C:\\u', TEAMRIG_HOME: 'C:/u/.teamrig', PATH: 'C:\\bin;C:\\u\\bin' },
    places: options.places ?? [KIT, CODEX],
    canonical: (path) => Promise.resolve(options.platform === 'linux' ? undefined : REAL[fileKey(path)]),
  };
}

function call(tool: string, input: JsonRecord, cwd = 'C:/w'): JsonRecord {
  return { tool_name: tool, tool_input: input, cwd };
}

/** The decision and reason the guard's reply gives as the shipped host writes it, or undefined for none. */
async function decide(payload: JsonRecord, guardEnv: InstallGuardEnv = env()): Promise<{ readonly decision: string; readonly reason: string } | undefined> {
  const output = replyText('tool-start', await installGuardReply(hookEventOf(payload, guardEnv.platform), guardEnv));
  if (output === '') {
    return undefined;
  }
  const parsed: unknown = JSON.parse(output);
  assert.ok(isRecord(parsed));
  const hook = recordField(parsed, 'hookSpecificOutput');
  assert.ok(hook !== undefined);
  return { decision: stringField(hook, 'permissionDecision') ?? '', reason: stringField(hook, 'permissionDecisionReason') ?? '' };
}

async function decisionOf(payload: JsonRecord, guardEnv?: InstallGuardEnv): Promise<string | undefined> {
  return (await decide(payload, guardEnv))?.decision;
}

describe('segmentPattern', () => {
  it('matches a name, its 8.3 short name and its trailing dots, nothing longer', () => {
    const match = (name: string, text: string): boolean => new RegExp(`^${segmentPattern(name)}$`, 'i').test(text);
    assert.ok(match('.teamrig', 'TEAMRI~1'));
    assert.ok(match('current.json', 'CURREN~1.JSO'));
    assert.ok(match('current.json', 'current.json..'));
    assert.ok(match('config.toml', 'CONFIG~2.TOM'));
    assert.ok(!match('current.json', 'CURREN~1'));
    assert.ok(!match('current', 'current.bak'));
    assert.ok(!match('.teamrig', '.teamrig-old'));
  });
});

describe('installGuardReply: file tools', () => {
  it('refuses a Write or Edit of each guarded entry, and of what a guarded folder holds', async () => {
    for (const path of ['C:/u/.teamrig/current', 'C:/u/.teamrig/current.json', 'C:/u/.teamrig/installs.json', 'C:/u/.teamrig/bin/teamrig.cmd', 'C:/u/.codex/hooks.json', 'C:/u/.codex/config.toml']) {
      assert.equal(await decisionOf(call('Write', { file_path: path, content: 'x' })), 'deny', path);
    }
    assert.equal(await decisionOf(call('Edit', { file_path: 'C:\\U\\.TEAMRIG\\versions\\0.5.0\\dist\\main.js', old_string: 'a', new_string: 'b' })), 'deny');
  });

  it('refuses a short name, trailing dots, a Git Bash drive and a path relative to the cwd', async () => {
    for (const path of ['C:/u/TEAMRI~1/CURREN~1.JSO', 'C:/u/.teamrig/current.json.', 'C:/u/.teamrig/versions./x', '/c/u/.teamrig/installs.json', '../u/.codex/HOOKS~1.JSO']) {
      assert.equal(await decisionOf(call('Write', { file_path: path, content: 'x' })), 'deny', path);
    }
  });

  it('refuses a path through a link to a guarded folder, by its real path', async () => {
    assert.equal(await decisionOf(call('Write', { file_path: 'C:/w/kit/bin/teamrig.cmd', content: 'x' })), 'deny');
  });

  it('refuses a device path, a share or a stream that names a guarded part', async () => {
    for (const path of ['\\\\?\\C:\\u\\.teamrig\\notes.md', 'C:/u/.teamrig/current.json:x', '\\\\host\\c$\\u\\.codex\\hooks.json']) {
      assert.equal(await decisionOf(call('Write', { file_path: path, content: 'x' })), 'deny', path);
    }
    assert.equal(await decisionOf(call('Write', { file_path: 'C:/w/notes.md:x', content: 'x' })), undefined);
  });

  it('passes the kit home\'s other entries and other files', async () => {
    for (const path of ['C:/u/.teamrig/teams/shop/notes.md', 'C:/u/.teamrig/scratch/x', 'C:/u/.codex/sessions/a.jsonl', 'C:/w/current.json', 'C:/u/.teamrig-old/current']) {
      assert.equal(await decisionOf(call('Write', { file_path: path, content: 'x' })), undefined, path);
    }
  });

  it('names the place, what writes it and the Read tool in the reason', async () => {
    const reply = await decide(call('Write', { file_path: 'C:/u/.codex/hooks.json', content: '{}' }));
    assert.ok(reply !== undefined);
    assert.ok(reply.reason.includes("Codex CLI's hook files (C:/u/.codex)"));
    assert.ok(reply.reason.includes('`teamrig setup hooks`'));
    assert.ok(reply.reason.includes('Read tool'));
  });

  it('leaves a Read open', async () => {
    assert.equal(await decisionOf(call('Read', { file_path: 'C:/u/.teamrig/current' })), undefined);
  });
});

describe('installGuardReply: shell lines', () => {
  it('refuses a line naming a guarded entry by any spelling of its folder', async () => {
    const lines = [
      'rm -r ~/.teamrig/versions',
      'cat C:/u/TEAMRI~1/CURREN~1.JSO',
      'echo x > /c/u/.teamrig/current',
      'cp a "$TEAMRIG_HOME/installs.json"',
      'cp a ${TEAMRIG_HOME}/bin/teamrig',
      'echo {} > "$USERPROFILE/.codex/hooks.json"',
      'rm -rf .teamrig/bin',
    ];
    for (const command of lines) {
      assert.equal(await decisionOf(call('Bash', { command }, 'C:/u')), 'deny', command);
    }
    assert.equal(await decisionOf(call('PowerShell', { command: 'Remove-Item $env:USERPROFILE\\.teamrig\\current' })), 'deny');
    assert.equal(await decisionOf(call('PowerShell', { command: 'Set-Content %USERPROFILE%\\.codex\\config.toml x' })), 'deny');
  });

  it('refuses a guarded entry as a word of its own once the line names the folder, or runs in it', async () => {
    assert.equal(await decisionOf(call('Bash', { command: 'cd ~/.teamrig && rm current' })), 'deny');
    assert.equal(await decisionOf(call('Bash', { command: 'rm ./current.json' }, 'C:/u/.teamrig')), 'deny');
    assert.equal(await decisionOf(call('Bash', { command: 'echo x > installs.json' }, 'C:/u/.teamrig')), 'deny');
  });

  it('refuses any line run inside a guarded entry', async () => {
    assert.equal(await decisionOf(call('Bash', { command: 'ls' }, 'C:/u/.teamrig/versions/0.5.0')), 'deny');
  });

  it('passes the kit home\'s other entries, lookalike folders and a variable holding a path list', async () => {
    const lines = ['ls ~/.teamrig/teams/shop', 'cat ~/.teamrig-old/current', 'cat ~/.teamrig.bak/current', 'rm current.json', 'echo $PATH/current'];
    for (const command of lines) {
      assert.equal(await decisionOf(call('Bash', { command })), undefined, command);
    }
    assert.equal(await decisionOf(call('Bash', { command: 'rm current' }, 'C:/u/.teamrig/teams')), undefined);
  });
});

describe('installGuardReply: posix', () => {
  const posixKit: GuardedPlace = { ...KIT, folder: '/srv/u/.teamrig' };
  const posixEnv = env({ platform: 'linux', places: [posixKit], variables: { HOME: '/srv/u', PATH: '/usr/bin:/bin' } });

  it('refuses a write and a shell line naming the kit, by its path, ~ or $HOME', async () => {
    assert.equal(await decisionOf(call('Write', { file_path: '/srv/u/.teamrig/current', content: 'x' }, '/srv/w'), posixEnv), 'deny');
    for (const command of ['rm ~/.teamrig/current', 'rm $HOME/.teamrig/bin/teamrig', 'rm /srv/u/.teamrig/versions -r']) {
      assert.equal(await decisionOf(call('Bash', { command }, '/srv/w'), posixEnv), 'deny', command);
    }
  });

  it('passes the kit\'s teams folder', async () => {
    assert.equal(await decisionOf(call('Write', { file_path: '/srv/u/.teamrig/teams/shop/a.md', content: 'x' }, '/srv/w'), posixEnv), undefined);
    assert.equal(await decisionOf(call('Bash', { command: 'ls ~/.teamrig/teams' }, '/srv/w'), posixEnv), undefined);
  });
});
