import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import { isRecord } from '../../../plugin-api/index.ts';
import { antigravityUserHooks } from './user-hooks.ts';

const POSIX_HOME = posix.join('/', 'home', 'ada');
const WIN_HOME = win32.join('C:', 'Users', 'ada');

const SOURCE = {
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/cli/main.js', 'hook', 'stop'], timeout: 10 }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/cli/guard-main.js', 'hook', 'push-guard'], timeout: 15 }] }],
    PreCompact: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/cli/main.js', 'hook', 'compact-hold'] }] }],
  },
};

describe('antigravityUserHooks', () => {
  it('writes to ~/.gemini/config/hooks.json on POSIX and Windows and needs no configLines', () => {
    assert.equal(antigravityUserHooks('linux').file(POSIX_HOME), posix.join(POSIX_HOME, '.gemini', 'config', 'hooks.json'));
    assert.equal(antigravityUserHooks('win32').file(WIN_HOME), win32.join(WIN_HOME, '.gemini', 'config', 'hooks.json'));
    assert.deepEqual(antigravityUserHooks('linux').configLines, []);
    assert.deepEqual(antigravityUserHooks('win32').configLines, []);
  });

  it('inserts the teamrig group with --host antigravity-cli --host-event, preserves other groups, and uses sh vs cmd quoting', () => {
    const posixAns = antigravityUserHooks('linux').merge(
      { custom: { Stop: [{ type: 'command', command: 'echo mine', timeout: 5 }] } },
      SOURCE,
      '/opt/my plugin',
    );
    assert.equal(posixAns.ok, true);
    assert.deepEqual(posixAns.value.counts, { inserted: 2, unchanged: 0, changed: 0, removed: 0 });
    assert.ok(posixAns.value.file !== undefined);
    assert.deepEqual(posixAns.value.file['custom'], { Stop: [{ type: 'command', command: 'echo mine', timeout: 5 }] });
    const teamrigPosix = posixAns.value.file['teamrig'];
    assert.ok(isRecord(teamrigPosix));
    const stopPosix = Array.isArray(teamrigPosix['Stop']) ? teamrigPosix['Stop'][0] : undefined;
    assert.ok(isRecord(stopPosix));
    assert.equal(stopPosix['command'], "node '/opt/my plugin/dist/cli/main.js' hook stop --host antigravity-cli --host-event Stop");
    assert.equal(posixAns.value.skipped.length, 1);
    assert.match(posixAns.value.skipped[0] ?? '', /^PreCompact:.*event agy lacks$/u);

    const winAns = antigravityUserHooks('win32').merge({}, SOURCE, 'C:\\my plugin');
    assert.equal(winAns.ok, true, winAns.ok ? '' : winAns.problem);
    const teamrigWin = winAns.value.file?.['teamrig'];
    assert.ok(isRecord(teamrigWin));
    const stopWin = Array.isArray(teamrigWin['Stop']) ? teamrigWin['Stop'][0] : undefined;
    assert.ok(isRecord(stopWin));
    assert.equal(stopWin['command'], 'node "C:\\my plugin/dist/cli/main.js" hook stop --host antigravity-cli --host-event Stop');
  });

  it('returns file: undefined when the teamrig group is already up to date', () => {
    const port = antigravityUserHooks('linux');
    const first = port.merge({}, SOURCE, '/opt/teamrig');
    assert.equal(first.ok, true);
    assert.ok(first.value.file !== undefined);
    const second = port.merge(first.value.file, SOURCE, '/opt/teamrig');
    assert.equal(second.ok, true);
    assert.equal(second.value.file, undefined);
    assert.deepEqual(second.value.counts, { inserted: 0, unchanged: 2, changed: 0, removed: 0 });
  });

  it('counts changed and removed handlers on update and refuses a non-object teamrig group', () => {
    const port = antigravityUserHooks('linux');
    const bad = port.merge({ teamrig: ['not-an-object'] }, SOURCE, '/opt/teamrig');
    assert.equal(bad.ok, false);
    const first = port.merge({}, SOURCE, '/opt/teamrig');
    assert.equal(first.ok, true);
    assert.ok(first.value.file !== undefined);
    const updatedSource = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/cli/main.js', 'hook', 'stop'], timeout: 20 }] }],
      },
    };
    const second = port.merge(first.value.file, updatedSource, '/opt/teamrig');
    assert.equal(second.ok, true);
    assert.deepEqual(second.value.counts, { inserted: 0, unchanged: 0, changed: 1, removed: 1 });
  });

  it('refuses an invalid pluginRoot, formats skipped matchers, and tolerates malformed entries or duplicate commands', () => {
    const port = antigravityUserHooks('win32');
    const badRoot = port.merge({}, SOURCE, 'relative/root');
    assert.equal(badRoot.ok, false);

    const withSkippedMatcher = {
      hooks: {
        PreToolUse: [{ matcher: 'NotebookEdit', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/dist/cli/main.js" hook nb' }] }],
      },
    };
    const skippedRes = port.merge({}, withSkippedMatcher, 'C:\\opt\\teamrig');
    assert.equal(skippedRes.ok, true);
    assert.match(skippedRes.value.skipped[0] ?? '', /^PreToolUse \(NotebookEdit\):/u);

    const dupSource = {
      hooks: {
        Stop: [{
          hooks: [
            { type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/dist/cli/main.js" hook stop', timeout: 10 },
          ],
        }],
      },
    };
    const malformedCurrent = {
      teamrig: {
        Stop: [
          'not-an-object',
          { hooks: [{ type: 'command' }] },
          { type: 'command', command: 'echo dup' },
          { type: 'command', command: 'echo dup' },
        ],
        InvalidEvent: 'not-an-array',
      },
    };
    const dupRes = antigravityUserHooks('linux').merge(malformedCurrent, dupSource, '/opt/teamrig');
    assert.equal(dupRes.ok, true);
    assert.deepEqual(dupRes.value.counts, { inserted: 1, unchanged: 0, changed: 0, removed: 2 });
  });
});
