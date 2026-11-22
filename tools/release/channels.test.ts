import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clockText, currentSlot, minutesIn, nextSlot, parseChannels, readChannels, slotHold, slotHoldAt, slotStart, type Channels } from './channels.ts';

const TEXT = JSON.stringify({ zone: 'Asia/Jerusalem', previewSlots: ['09:00', '12:00', '21:00'], stableAt: '20:00', soakHours: 3 });
const CHANNELS: Channels = parseChannels(TEXT);
/** 2026-11-22 is in winter time: Asia/Jerusalem is UTC+2. */
const at = (utc: string): Date => new Date(`2026-11-22T${utc}Z`);

describe('parseChannels', () => {
  it('reads times as minutes after midnight', () => {
    assert.deepEqual(CHANNELS, { zone: 'Asia/Jerusalem', previewSlots: [540, 720, 1260], stableAt: 1200, soakHours: 3 });
  });

  it("reads the repo's own channels.json", () => {
    assert.ok(readChannels().previewSlots.length > 0);
  });

  for (const [what, over, expected] of [
    ['a time of another shape', { stableAt: '8pm' }, /stableAt is not an HH:MM time/],
    ['an hour past 23', { previewSlots: ['24:00'] }, /previewSlots\[0\] is not an HH:MM time/],
    ['no slots', { previewSlots: [] }, /previewSlots is not a list/],
    ['slots out of order', { previewSlots: ['12:00', '09:00'] }, /not in ascending order/],
    ['a zone Node does not know', { zone: 'Mars/Olympus' }, /not a time zone this Node knows/],
    ['no zone', { zone: '' }, /zone is not a time zone name/],
    ['a soak of no hours', { soakHours: 0 }, /soakHours is not a whole number/],
    ['a soak of part of an hour', { soakHours: 2.5 }, /soakHours is not a whole number/],
  ] as const) {
    it(`refuses ${what}`, () => {
      assert.throws(() => parseChannels(JSON.stringify({ ...JSON.parse(TEXT), ...over })), expected);
    });
  }

  it('refuses a file that is not an object', () => {
    assert.throws(() => parseChannels('[]'), /expected \{/);
  });
});

describe('the preview slot clock', () => {
  it("reads the zone's wall clock, not UTC's", () => {
    assert.equal(minutesIn(at('07:30:00'), 'Asia/Jerusalem'), 9 * 60 + 30);
    assert.equal(clockText(9 * 60 + 5), '09:05');
  });

  it('puts a time in the slot that started last, up to the next, wrapping past midnight', () => {
    assert.equal(currentSlot(at('07:00:00'), CHANNELS), 540);
    assert.equal(currentSlot(at('09:59:00'), CHANNELS), 540);
    assert.equal(currentSlot(at('10:00:00'), CHANNELS), 720);
    assert.equal(currentSlot(at('05:00:00'), CHANNELS), 1260);
    assert.equal(nextSlot(at('05:00:00'), CHANNELS), 540);
    assert.equal(nextSlot(at('20:00:00'), CHANNELS), 540);
  });

  it("starts a slot at its time on the zone's clock, to the minute", () => {
    assert.deepEqual(slotStart(at('08:41:17'), CHANNELS), at('07:00:00'));
    assert.deepEqual(slotStart(at('05:00:00'), CHANNELS), new Date('2026-11-21T19:00:00Z'));
  });

  it('starts a slot at its true instant across a clock change inside it', () => {
    // Israel's clocks went forward an hour at 02:00 on 2026-03-27: 08:00 the next morning is 05:00 UTC, and the 21:00
    // slot of the evening before, still winter time, started at 19:00 UTC.
    assert.deepEqual(slotStart(new Date('2026-03-27T05:00:00Z'), CHANNELS), new Date('2026-03-26T19:00:00Z'));
  });
});

describe('slotHold', () => {
  it('lets the first release of a slot merge, however late in it', () => {
    assert.equal(slotHold(at('09:55:00'), null, CHANNELS), null);
    assert.equal(slotHold(at('09:55:00'), at('06:59:59'), CHANNELS), null);
  });

  it('holds a second release in the same slot, naming the slot and the next', () => {
    assert.equal(slotHold(at('09:55:00'), at('07:00:00'), CHANNELS), 'a preview release already merged in the 09:00 slot: the next starts at 12:00 Asia/Jerusalem');
    assert.equal(slotHold(at('22:00:00'), at('19:30:00'), CHANNELS), 'a preview release already merged in the 21:00 slot: the next starts at 09:00 Asia/Jerusalem');
  });
});

describe('slotHoldAt', () => {
  it('asks slotHold at the time it was made', () => {
    const hold = slotHoldAt(at('09:55:00'), CHANNELS);
    assert.equal(hold(null), null);
    assert.equal(hold(at('07:00:00')), slotHold(at('09:55:00'), at('07:00:00'), CHANNELS));
  });
});
