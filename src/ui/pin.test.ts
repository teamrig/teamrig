import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../config/parse.ts';
import { isArchivePath } from './archive.ts';
import { RELEASED_UI } from './pin.ts';

describe('RELEASED_UI', () => {
  it('names a plain version, an https address and a lowercase sha256', () => {
    assert.ok(RELEASED_UI !== undefined, 'a teamrig-pane release is pinned');
    assert.ok(isArchivePath(RELEASED_UI.version) && !RELEASED_UI.version.includes('/'), RELEASED_UI.version);
    assert.equal(new URL(RELEASED_UI.url).protocol, 'https:');
    assert.match(RELEASED_UI.sha256, /^[0-9a-f]{64}$/);
  });

  it("fetches the archive teamrig-pane's release of that same version carries", () => {
    assert.ok(RELEASED_UI !== undefined);
    const tag = `teamrig-pane-v${RELEASED_UI.version}`;
    assert.equal(RELEASED_UI.url, `https://github.com/teamrig/teamrig-pane/releases/download/${tag}/teamrig-ui.json`);
  });

  it('is never set or replaced by the team config', () => {
    const pin = { version: '9.9.9', url: 'https://example.com/teamrig-ui.json', sha256: 'ab'.repeat(32) };
    const raw = { sessions: ['alpha'], roles: { lead: 'alpha' }, ui: { pin, ...pin, released: pin } };
    assert.deepEqual(parseConfig(raw).config.ui, { mode: 'terminal' });
  });
});
