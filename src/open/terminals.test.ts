import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { autoTerminals, splittableTerminal, tabbingTerminal, teamWindowOf } from './terminals.ts';

describe('teamWindowOf', () => {
  it("names the team's own window when the team keeps one (T1427), and none when it keeps its tabs with the others", () => {
    assert.equal(teamWindowOf(true, 'shop'), 'teamrig-shop');
    assert.equal(teamWindowOf(false, 'shop'), undefined);
  });
});

describe('splittableTerminal (T5105)', () => {
  it('finds tmux by its pane variable, inside Windows Terminal too, and none outside it', () => {
    assert.equal(splittableTerminal({ TMUX: '/tmp/tmux-1/default,1,0', WT_SESSION: 'guid' }), 'tmux');
    assert.equal(splittableTerminal({ TMUX: '/tmp/tmux-1/default,1,0' }), 'tmux');
    assert.equal(splittableTerminal({}), undefined);
  });

  it("never names Windows Terminal, whose split is of the focused tab, not the run's own (T5831)", () => {
    assert.equal(splittableTerminal({ TMUX: '', WT_SESSION: 'guid' }), undefined);
    assert.equal(splittableTerminal({ WT_SESSION: 'guid' }), undefined);
  });
});

describe('tabbingTerminal (T5831)', () => {
  it('names Windows Terminal by WT_SESSION, and none outside it or inside tmux, which splits instead', () => {
    assert.equal(tabbingTerminal({ WT_SESSION: 'guid' }), 'windows-terminal');
    assert.equal(tabbingTerminal({ TMUX: '', WT_SESSION: 'guid' }), 'windows-terminal');
    assert.equal(tabbingTerminal({ TMUX: '/tmp/tmux-1/default,1,0', WT_SESSION: 'guid' }), undefined);
    assert.equal(tabbingTerminal({ WT_SESSION: '' }), undefined);
    assert.equal(tabbingTerminal({}), undefined);
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
