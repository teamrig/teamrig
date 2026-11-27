import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { autoTerminals, splittableTerminal, teamWindowOf } from './terminals.ts';

describe('teamWindowOf', () => {
  it("names the team's own window when the team keeps one (T1427), and none when it keeps its tabs with the others", () => {
    assert.equal(teamWindowOf(true, 'shop'), 'teamrig-shop');
    assert.equal(teamWindowOf(false, 'shop'), undefined);
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
