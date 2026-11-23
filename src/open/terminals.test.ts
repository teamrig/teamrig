import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { autoTerminals, splitCommand, splittableTerminal, teamWindowOf, type TabRequest } from './terminals.ts';

const ARGV = ['/usr/bin/node', '/opt/teamrig/dist/cli/main.js', 'launch', 'api', '--team', 'shop', '--project', '/w/shop', '--encoded-prompt', 'SGk'];
const TAB: TabRequest = { title: 'shop-api', folder: '/w/shop', argv: ARGV, window: undefined, focus: 'take' };

describe('teamWindowOf', () => {
  it("names the team's own window when the team keeps one (T1427), and none when it keeps its tabs with the others", () => {
    assert.equal(teamWindowOf(true, 'shop'), 'teamrig-shop');
    assert.equal(teamWindowOf(false, 'shop'), undefined);
  });
});

describe('splitCommand (T5105)', () => {
  it('splits the tmux pane the run works in, side by side, keeping the focus there by -d', () => {
    assert.deepEqual(splitCommand('tmux', { ...TAB, focus: 'keep' }), {
      kind: 'command',
      request: { command: 'tmux', args: ['split-window', '-h', '-d', '-c', '/w/shop', ...ARGV], cwd: '/w/shop', mode: 'exit' },
    });
    assert.deepEqual(splitCommand('tmux', TAB), {
      kind: 'command',
      request: { command: 'tmux', args: ['split-window', '-h', '-c', '/w/shop', ...ARGV], cwd: '/w/shop', mode: 'exit' },
    });
  });

  it("splits Windows Terminal's most recent window, never a named one, the command after --", () => {
    const tab: TabRequest = { title: 'teamrig ui shop', folder: 'C:\\w\\shop', argv: ['C:\\node\\node.exe', 'C:\\kit\\main.js', 'ui'], window: teamWindowOf(true, 'shop'), focus: 'keep' };
    assert.deepEqual(splitCommand('windows-terminal', tab), {
      kind: 'command',
      request: {
        command: 'wt.exe',
        args: ['-w', '0', 'split-pane', '--vertical', '--title', 'teamrig ui shop', '-d', 'C:\\w\\shop', '--', 'C:\\node\\node.exe', 'C:\\kit\\main.js', 'ui'],
        cwd: 'C:\\w\\shop',
        mode: 'exit',
      },
    });
  });

  it('refuses a split Windows Terminal would misread', () => {
    assert.deepEqual(splitCommand('windows-terminal', { ...TAB, folder: 'C:\\a;b' }), {
      kind: 'unusable',
      why: 'Windows Terminal would misread "C:\\\\a;b" (it holds ; " % or a control character)',
    });
  });
});

describe('splittableTerminal (T5105)', () => {
  it('finds tmux before Windows Terminal by their pane variables, and none outside both', () => {
    assert.equal(splittableTerminal({ TMUX: '/tmp/tmux-1/default,1,0', WT_SESSION: 'guid' }), 'tmux');
    assert.equal(splittableTerminal({ TMUX: '', WT_SESSION: 'guid' }), 'windows-terminal');
    assert.equal(splittableTerminal({ WT_SESSION: '' }), undefined);
    assert.equal(splittableTerminal({}), undefined);
  });
});

describe('autoTerminals', () => {
  it('tries tmux first inside tmux, then the platform terminal', () => {
    assert.deepEqual(autoTerminals({}, 'win32'), ['windows-terminal']);
    assert.deepEqual(autoTerminals({ TMUX: '' }, 'darwin'), ['macos-terminal']);
    assert.deepEqual(autoTerminals({ TMUX: '/tmp/tmux-1/default,1,0' }, 'darwin'), ['tmux', 'macos-terminal']);
    assert.deepEqual(autoTerminals({}, 'linux'), ['gnome-terminal', 'konsole', 'x-terminal-emulator']);
    assert.deepEqual(autoTerminals({ TMUX: 'x' }, 'freebsd'), ['tmux', 'gnome-terminal', 'konsole', 'x-terminal-emulator']);
  });
});
