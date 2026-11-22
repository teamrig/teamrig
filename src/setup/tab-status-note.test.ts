import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tabStatusLine, type TabStatusFacts, type TitleHold } from './tab-status-note.ts';

const ON: TabStatusFacts = { team: 'shop', configOn: true, configPath: '/kit/teams/shop/config.json', title: { kind: 'hooks' }, settingsPath: '/u/.claude/settings.json' };
const CLAUDE_HOLDS: TitleHold = { kind: 'host', hostName: 'Claude Code', variable: 'CLAUDE_CODE_DISABLE_TERMINAL_TITLE', value: '1' };
const CIRCLE = 'each tab of team shop shows a colored circle before its title for what its session is doing';
const SET_CONFIG = 'set "tabStatus": { "enabled": true } in /kit/teams/shop/config.json';
const ADD_SWITCH =
  'add "CLAUDE_CODE_DISABLE_TERMINAL_TITLE": "1" to "env" in /u/.claude/settings.json and restart Claude Code, so it stops writing its own title over the circle (tabs of projects outside teamrig then keep the terminal\'s title)';

describe('tabStatusLine', () => {
  it('names the switch alone, and no settings file, where none of the host is known', () => {
    assert.equal(
      tabStatusLine({ ...ON, title: CLAUDE_HOLDS, settingsPath: undefined }),
      `NOTE ${CIRCLE} once you set CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 in the environment the team's sessions start in and restart them, so the host stops writing its own title over the circle`,
    );
    assert.equal(tabStatusLine({ ...ON, settingsPath: undefined }), `TAB STATUS on: ${CIRCLE}: green ready, yellow working, orange waiting on you`);
  });

  it('says tab status is on when the config turns it on and Claude Code leaves the title to hooks', () => {
    assert.equal(tabStatusLine(ON), `TAB STATUS on: ${CIRCLE}: green ready, yellow working, orange waiting on you`);
  });

  it('names the Claude Code switch and where it goes when Claude Code still writes the title', () => {
    assert.equal(tabStatusLine({ ...ON, title: CLAUDE_HOLDS }), `NOTE ${CIRCLE} once you ${ADD_SWITCH}`);
  });

  it('names the config key of a kept config that has tab status off', () => {
    assert.equal(tabStatusLine({ ...ON, configOn: false }), `NOTE ${CIRCLE} once you ${SET_CONFIG}`);
  });

  it('names both, the config first, when both are off', () => {
    assert.equal(tabStatusLine({ ...ON, configOn: false, title: CLAUDE_HOLDS }), `NOTE ${CIRCLE} once you ${SET_CONFIG}, and ${ADD_SWITCH}`);
  });

  it("names another host's switch, its value and its program as the host tells them", () => {
    const other: TitleHold = { kind: 'host', hostName: 'Other CLI', variable: 'OTHER_TITLE_OFF', value: 'yes' };
    assert.equal(
      tabStatusLine({ ...ON, title: other }),
      `NOTE ${CIRCLE} once you add "OTHER_TITLE_OFF": "yes" to "env" in /u/.claude/settings.json and restart Other CLI, so it stops writing its own title over the circle (tabs of projects outside teamrig then keep the terminal's title)`,
    );
    assert.match(tabStatusLine({ ...ON, title: other, settingsPath: undefined }), /once you set OTHER_TITLE_OFF=yes in the environment/);
  });

  it('says the circle needs a host that calls the hooks where this one calls none', () => {
    assert.equal(tabStatusLine({ ...ON, title: { kind: 'no-hooks' } }), `NOTE ${CIRCLE} once you run the team's sessions on a host that calls teamrig's hooks, which write the circle`);
  });
});
