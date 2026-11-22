import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hookBridge } from './hook-bridge.ts';
import { TITLE_SWITCH } from './title-switch.ts';
import { toolCallShape } from './tool-call.ts';

describe("Claude Code's title switch", () => {
  it('reads CLAUDE_CODE_DISABLE_TERMINAL_TITLE as on for 1, true, yes and on, in any case and spacing', () => {
    for (const value of ['1', 'true', ' YES ', 'On']) {
      assert.equal(TITLE_SWITCH.on({ CLAUDE_CODE_DISABLE_TERMINAL_TITLE: value }), true, value);
    }
    for (const value of [undefined, '', '0', 'false', 'off']) {
      assert.equal(TITLE_SWITCH.on({ CLAUDE_CODE_DISABLE_TERMINAL_TITLE: value }), false, String(value));
    }
  });

  it('names the variable and the value a note tells the person to set', () => {
    assert.deepEqual([TITLE_SWITCH.variable, TITLE_SWITCH.value], ['CLAUDE_CODE_DISABLE_TERMINAL_TITLE', '1']);
    assert.equal(TITLE_SWITCH.on({ [TITLE_SWITCH.variable]: TITLE_SWITCH.value }), true);
  });

  it('is what the hook port gives', () => {
    assert.equal(hookBridge(toolCallShape('linux')).titleSwitch, TITLE_SWITCH);
  });
});
