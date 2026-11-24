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
      'wsl rm -rf /mnt/c/u/.t*',
      'wsl -d Ubuntu rm -rf /mnt/c/u/.teamrig',
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

  it('each shell spelling resolves to the guarded path: dot segments, quotes inside a name, escapes and variables', async () => {
    const bash = ['echo 0.0.1 > ~/.teamrig/teams/../current', `echo 0.0.1 > ~/.teamrig/cu''rrent`, 'echo 0.0.1 > ~/.teamrig/"current"', 'cat C:/u/.codex/./hooks.json'];
    for (const command of bash) {
      assert.equal(await decisionOf(call('Bash', { command })), 'deny', command);
    }
    const powershell = [
      "Set-Content ~\\.teamrig\\`current '0.0.1'",
      "Set-Content ${env:USERPROFILE}\\.teamrig\\current '0.0.1'",
      "Set-Content $HOME\\.teamrig\\current '0.0.1'",
      "Set-Content '~\\.teamrig\\teams\\..\\current' '0.0.1'",
    ];
    for (const command of powershell) {
      assert.equal(await decisionOf(call('PowerShell', { command })), 'deny', command);
    }
  });

  it('each shell spelling resolves to the guarded path from a cwd inside the kit home', async () => {
    assert.equal(await decisionOf(call('Bash', { command: 'echo 0.0.1 > ../../current' }, 'C:/u/.teamrig/teams/t')), 'deny');
    assert.equal(await decisionOf(call('PowerShell', { command: "Set-Content ..\\..\\installs.json '{}'" }, 'C:/u/.teamrig/teams/t')), 'deny');
  });

  it('refuses a glob or a substitution that can complete to a guarded entry', async () => {
    for (const command of ['cp evil.toml ~/.codex/conf*.toml', 'rm ~/.teamrig/*', 'rm ~/.tea*/current', 'cp a ~/.teamrig/$(echo current)', 'cp a ~/.codex/hooks.[j]son']) {
      assert.equal(await decisionOf(call('Bash', { command })), 'deny', command);
    }
    assert.equal(await decisionOf(call('PowerShell', { command: "Set-Content ~\\.teamrig\\curr* '0.0.1'" })), 'deny');
  });

  it('refuses the guarded folder itself, or a glob that can match its name, for any command (T5364 R1)', async () => {
    const bash = ['rm -rf ~/.teamrig', 'mv ~/.teamrig ~/old', 'rm -rf ~/.codex', 'rm -rf ~/.teamrig/', 'rm -rf ~/.t*', 'ls ~/*', 'rm -rf C:/u/TEAMRI~1'];
    for (const command of bash) {
      assert.equal(await decisionOf(call('Bash', { command })), 'deny', command);
    }
    for (const command of ['Remove-Item -Recurse ~\\.teamrig', 'Remove-Item -Recurse ~\\*', 'Move-Item $env:USERPROFILE\\.codex C:\\old']) {
      assert.equal(await decisionOf(call('PowerShell', { command })), 'deny', command);
    }
    assert.equal(await decisionOf(call('Write', { file_path: 'C:/u/.teamrig', content: 'x' })), 'deny');
  });

  it('passes an ancestor of a guarded folder, and a glob at home that cannot match its name', async () => {
    for (const command of ['ls ~', 'ls ~/*.md', 'rm -rf ~/old', 'echo hi > ~/$(x)']) {
      assert.equal(await decisionOf(call('Bash', { command })), undefined, command);
    }
    assert.equal(await decisionOf(call('PowerShell', { command: 'Get-ChildItem ~\\*.log' })), undefined);
  });

  it('passes a glob, a substitution or a dot segment that stays outside the guarded entries', async () => {
    const lines = ['ls ~/.teamrig/teams/*', 'ls ~/.teamrig/t*', 'echo ~/$(date)', 'cat ~/.codex/sessions/*.jsonl', 'git status'];
    for (const command of lines) {
      assert.equal(await decisionOf(call('Bash', { command })), undefined, command);
    }
    assert.equal(await decisionOf(call('Bash', { command: 'echo hi > ../t2/notes.md' }, 'C:/u/.teamrig/teams/t')), undefined);
    assert.equal(await decisionOf(call('PowerShell', { command: "Set-Content ..\\t2\\notes.md 'hi'" }, 'C:/u/.teamrig/teams/t')), undefined);
  });

  it('names no path past the place in the reason of a word it resolves', async () => {
    const reply = await decide(call('Bash', { command: 'echo 0.0.1 > ~/.teamrig/teams/../current' }));
    assert.ok(reply !== undefined);
    assert.ok(reply.reason.includes('(C:/u/.teamrig)'));
    assert.ok(!reply.reason.includes('current'), reply.reason);
  });

  it('resolves the words after a cd, pushd or Set-Location in the line against that folder (T5364 R2)', async () => {
    const bash = [
      'cd ~/.teamrig/teams && echo 0.0.1 > ../current',
      'pushd ~/.teamrig/teams && echo 0.0.1 > ../current',
      'cd /c/u/.codex; cp evil.toml config.toml',
      'cd ~/.team* && echo 0.0.1 > current',
      'cd ~/$(x) && echo 0.0.1 > current',
    ];
    for (const command of bash) {
      assert.equal(await decisionOf(call('Bash', { command })), 'deny', command);
    }
    const powershell = ["Set-Location ~\\.teamrig\\teams; Set-Content ..\\current '0.0.1'", "sl -Path $HOME\\.codex\\sessions; Set-Content ..\\hooks.json '{}'"];
    for (const command of powershell) {
      assert.equal(await decisionOf(call('PowerShell', { command })), 'deny', command);
    }
  });

  it('passes the words after a cd that stays outside the guarded entries, in a subshell, or to an unknown folder', async () => {
    const lines = [
      'cd ~/.teamrig/teams/t && echo hi > notes.md',
      '(cd ~/.teamrig/teams/t) && echo hi > ../../cur?ent',
      'cd $(git rev-parse --show-toplevel) && echo hi > current',
      'cd ~/$(x) && npm test',
      'cd ~/.teamrig/teams && cd t && echo hi > ../t2/notes.md',
    ];
    for (const command of lines) {
      assert.equal(await decisionOf(call('Bash', { command })), undefined, command);
    }
  });

  it('resolves a bash variable the line binds before it reads it (T5364 R3)', async () => {
    const lines = ['X=~/.teamrig; echo 0.0.1 > $X/current', 'K=C:/u/.codex && cp evil.toml "$K/config.toml"', 'export D=~/.teamrig/teams; echo 0.0.1 > ${D}/../current', 'X=~/.teamrig; rm -rf $X'];
    for (const command of lines) {
      assert.equal(await decisionOf(call('Bash', { command })), 'deny', command);
    }
  });

  it('reads a bash variable bound to a pattern as that pattern, which its unquoted use completes (T5369)', async () => {
    for (const command of ['X=~/.t*; rm -rf $X', 'X=~/.t*; bash -c "rm -rf $X"', 'X=/c/u/.co?ex; rm -rf $X/hooks.json', 'X=~/.teamrig/cur[r]ent; echo 0.0.1 > $X']) {
      assert.equal(await decisionOf(call('Bash', { command }, 'C:/u')), 'deny', command);
    }
  });

  it('reads every value a bash line gives a variable: declaration builtins, groups, functions, if bodies (T5378)', async () => {
    const lines = [
      'declare X=~/.teamrig; rm -rf $X/current',
      'declare X=~/.t*; rm -rf $X',
      'declare -x X=~/.t*; rm -rf $X',
      'typeset X=~/.t*; rm -rf $X',
      'local X=~/.t*; rm -rf $X',
      'readonly X=~/.t*; rm -rf $X',
      'readonly X=~/.teamrig; rm -rf $X/current',
      'export X=~/.teamrig; rm -rf $X/current',
      'f() { X=~/.t*; rm -rf $X; }; f',
      'function f { X=~/.t*; rm -rf $X; }; f',
      '{ X=~/.t*; rm -rf $X; }',
      'X=~/.teamrig; f() { rm -rf $X; }; f',
      'if true; then X=~/.t*; fi; rm -rf $X',
      'X=/tmp; X=~/.teamrig; rm -rf $X',
      'X=~/.teamrig; X=/tmp; rm -rf $X',
    ];
    for (const command of lines) {
      assert.equal(await decisionOf(call('Bash', { command }, 'C:/u')), 'deny', command);
    }
  });

  it('refuses a bash line reading a variable a declaration option may change, or bound in too many ways (T5378)', async () => {
    const many = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name) => `${name}=/a; ${name}=/b`).join('; ');
    const lines = ['X=~/.TEAMRIG; declare -l X; rm -rf $X', 'declare -n X=Y; Y=~/.teamrig; rm -rf $X', 'declare $o X=~/.teamrig; rm -rf $X', `${many}; echo hi > $A$B$C$D$E$F$G`];
    for (const command of lines) {
      const decided = await decide(call('Bash', { command }, 'C:/u'));
      assert.equal(decided?.decision, 'deny', command);
      assert.match(decided.reason, /binds its variables in more than 64 ways, or reads one/, command);
    }
  });

  it('passes a bash line whose declaration options keep values, or that never reads the name they change (T5378)', async () => {
    for (const command of ['declare -p X; echo hi > notes.md', 'declare -l Y=A; X=/tmp; rm -rf $X', 'declare -rx X=/tmp; rm -rf $X/a']) {
      assert.equal(await decisionOf(call('Bash', { command }, 'C:/u')), undefined, command);
    }
  });

  it('passes a bash variable the line binds outside the guarded entries, or to a value only known when it runs', async () => {
    for (const command of ['X=~/.teamrig/teams/t; echo hi > $X/notes.md', 'X=$(mktemp -d); echo hi > $X/current', 'X=~/.teamrig/t*; ls $X', 'X=~/*.md; rm $X']) {
      assert.equal(await decisionOf(call('Bash', { command })), undefined, command);
    }
  });

  it('reads the line a nested shell runs with the same word pass (T5365 R4)', async () => {
    const bash = [
      'bash -c "rm -rf ~/.teamrig"',
      'sh -c "rm -rf ~/.teamrig"',
      'powershell -Command "Remove-Item -Recurse ~\\.teamrig"',
      "bash -c 'cd ~/.teamrig/teams && echo 0.0.1 > ../current'",
      'bash -c \'echo 0.0.1 > ~/.teamrig/cu""rrent\'',
      "bash -c \"sh -c 'rm -rf ~/.codex'\"",
      "eval 'cd ~/.teamrig' && rm -rf current",
      'bash <<EOF\nrm -rf ~/.teamrig\nEOF',
    ];
    for (const command of bash) {
      assert.equal(await decisionOf(call('Bash', { command })), 'deny', command);
    }
    const powershell = ['pwsh -Command "Remove-Item -Recurse ~\\.teamrig"', "bash -c 'rm -rf ~/.teamrig'"];
    for (const command of powershell) {
      assert.equal(await decisionOf(call('PowerShell', { command })), 'deny', command);
    }
  });

  it('passes a nested shell line that stays outside the guarded entries, and a nested cd that does not carry out', async () => {
    const lines = [
      "bash -c 'cd ~/.teamrig/teams/t && echo hi > notes.md'",
      'bash -c "echo hi > ~/.teamrig/teams/t/n.md"',
      "bash -c 'cd ~/.teamrig/teams' && echo hi > ../current",
      "sh -c 'rm -rf node_modules'",
    ];
    for (const command of lines) {
      assert.equal(await decisionOf(call('Bash', { command })), undefined, command);
    }
  });

  it('reads the static text a line pipes or substitutes into a shell that runs its stdin (T5366 R5)', async () => {
    const bash = [
      "echo 'rm -rf ~/.t*' | bash",
      "printf 'rm -rf ~/.t*\\n' | bash",
      "echo 'rm -rf ~/.t*' | sh -s",
      "cat <<'EOF' | bash\nrm -rf ~/.t*\nEOF",
      "bash -s < <(echo 'rm -rf ~/.t*')",
      "source <(echo 'rm -rf ~/.t*')",
      ". <(printf 'rm -rf ~/.t*')",
      'X=~/.teamrig; echo "rm -rf $X/current" | bash',
    ];
    for (const command of bash) {
      assert.equal(await decisionOf(call('Bash', { command })), 'deny', command);
    }
    const powershell = ["'Remove-Item -Recurse ~\\*' | iex", "Write-Output 'Remove-Item -Recurse ~\\.t*' | powershell -Command -"];
    for (const command of powershell) {
      assert.equal(await decisionOf(call('PowerShell', { command })), 'deny', command);
    }
  });

  it('passes a piped feed outside the guarded entries, one the line cannot show, and static text piped to a non-shell', async () => {
    const bash = [
      "echo 'npm test' | bash",
      "echo 'rm -rf ~/.t*' > notes.md",
      "echo 'rm -rf ~/.t*' | grep rm",
      'cat x.sh | bash',
      "source <(echo 'export A=1')",
    ];
    for (const command of bash) {
      assert.equal(await decisionOf(call('Bash', { command })), undefined, command);
    }
    assert.equal(await decisionOf(call('PowerShell', { command: "'Get-ChildItem C:\\w\\src' | iex" })), undefined);
  });

  it('reads shells nested 8 deep, and refuses a line nesting them deeper (T5366 R6)', async () => {
    const nested = (depth: number, inner: string): string => `${'eval '.repeat(depth)}${inner}`;
    assert.equal(await decisionOf(call('Bash', { command: nested(8, "'rm -rf ~/.t*'") })), 'deny');
    assert.equal(await decisionOf(call('Bash', { command: nested(8, 'echo hi') })), undefined);
    const deep = await decide(call('Bash', { command: nested(9, 'echo hi') }));
    assert.equal(deep?.decision, 'deny');
    assert.match(deep?.reason ?? '', /more than 8 deep/);
  });

  it("reads cmd's caret escape in a line the caller hands cmd unquoted (T5366 R7)", async () => {
    const powershell = [
      'cmd /c rmdir /s /q %USERPROFILE%\\.team^rig',
      'cmd /c rmdir /s /q %USERPROFILE%\\.teamri^g',
      "Start-Process cmd -ArgumentList '/c rmdir /s /q %USERPROFILE%\\.team^rig'",
      "Start-Process cmd -ArgumentList '/c','rmdir','/s','/q','%USERPROFILE%\\.team^rig'",
      "Start-Process cmd '/c rmdir /s /q %USERPROFILE%\\.team^rig'",
    ];
    for (const command of powershell) {
      assert.equal(await decisionOf(call('PowerShell', { command })), 'deny', command);
    }
    assert.equal(await decisionOf(call('Bash', { command: 'cmd //c rmdir //s //q %USERPROFILE%\\\\.team^rig' })), 'deny');
    assert.equal(await decisionOf(call('PowerShell', { command: 'cmd /c rmdir /s /q %USERPROFILE%\\.team^rig-old' })), undefined);
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
