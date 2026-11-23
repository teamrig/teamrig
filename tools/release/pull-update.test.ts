import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { parseChannels } from './channels.ts';
import { pullUpdate, pullUpdateCommand } from './pull-update.ts';

const CHANNELS = parseChannels(JSON.stringify({ zone: 'Asia/Jerusalem', previewSlots: ['09:00', '12:00', '21:00'], stableAt: '20:00', soakHours: 3 }));
/** 09:00 in Asia/Jerusalem, winter time (UTC+2). */
const SLOT_START = new Date('2026-11-22T07:00:00Z');
const minutesAfter = (minutes: number): Date => new Date(SLOT_START.getTime() + minutes * 60_000);

describe('pullUpdate', () => {
  it('updates the release pull request on the hourly run inside a slot’s first hour', () => {
    assert.deepEqual(pullUpdate('schedule', minutesAfter(1), CHANNELS), {
      update: true,
      reason: "the 09:00 slot started 1 min ago: the release pull request takes main's commits",
    });
    assert.equal(pullUpdate('schedule', minutesAfter(59), CHANNELS).update, true);
  });

  it('leaves it still on the later hourly runs of the slot, so its ci finishes', () => {
    assert.deepEqual(pullUpdate('schedule', minutesAfter(60), CHANNELS), {
      update: false,
      reason: 'the 09:00 slot started 60 min ago: the release pull request stays as it is until the next slot',
    });
    assert.equal(pullUpdate('schedule', minutesAfter(179), CHANNELS).update, false);
  });

  it('counts the slot that wraps past midnight from its own start', () => {
    // 01:30 the next day falls in the 21:00 slot, 270 minutes in.
    assert.equal(pullUpdate('schedule', new Date('2026-11-22T23:30:00Z'), CHANNELS).update, false);
    assert.equal(pullUpdate('schedule', new Date('2026-11-22T19:10:00Z'), CHANNELS).update, true);
  });

  it('never updates it on a push to main, which only tags a merged release', () => {
    assert.deepEqual(pullUpdate('push', minutesAfter(1), CHANNELS), {
      update: false,
      reason: 'a push to main only tags a merged release; the release pull request moves at a slot start',
    });
  });

  it('updates it on a run by hand, at any time', () => {
    assert.equal(pullUpdate('workflow_dispatch', minutesAfter(120), CHANNELS).update, true);
  });

  it('refuses an event release.yml does not run on', () => {
    assert.throws(() => pullUpdate('pull_request', minutesAfter(1), CHANNELS), /not pull_request/);
  });
});

describe('pullUpdateCommand', () => {
  let dir: string;
  let output: string;
  let summary: string;
  const lines: string[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pull-update-'));
    output = join(dir, 'output');
    summary = join(dir, 'summary');
    writeFileSync(output, '');
    writeFileSync(summary, '');
    lines.length = 0;
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (env: Readonly<Record<string, string | undefined>>, now: Date): number =>
    pullUpdateCommand({ GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, ...env }, { channels: CHANNELS, now, out: (line) => lines.push(line) });

  it('writes update=true and its reason at a slot start', () => {
    assert.equal(run({ GITHUB_EVENT_NAME: 'schedule' }, minutesAfter(2)), 0);
    assert.equal(readFileSync(output, 'utf8'), 'update=true\n');
    assert.equal(readFileSync(summary, 'utf8'), "Release pull request: updates: the 09:00 slot started 2 min ago: the release pull request takes main's commits\n");
    assert.deepEqual(lines, ["Release pull request: updates: the 09:00 slot started 2 min ago: the release pull request takes main's commits"]);
  });

  it('writes update=false on a push', () => {
    assert.equal(run({ GITHUB_EVENT_NAME: 'push' }, minutesAfter(2)), 0);
    assert.equal(readFileSync(output, 'utf8'), 'update=false\n');
  });

  it('throws naming a missing value, writing no output', () => {
    assert.throws(() => run({ GITHUB_EVENT_NAME: undefined }, minutesAfter(2)), /GITHUB_EVENT_NAME is not set/);
    assert.equal(readFileSync(output, 'utf8'), '');
  });
});
