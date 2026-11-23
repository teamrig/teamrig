import { readFileSync } from 'node:fs';
import { isRecord } from '../lib/guards.ts';

/**
 * The two release channels' clock (T5133), read from channels.json beside this file. Preview gets at most one release
 * per slot: each of `previewSlots` starts a slot that lasts to the next, and the first release head that is green after
 * a slot starts merges, even late, so a slow ci run or a late GitHub cron never skips a slot. A slot with nothing new
 * cuts nothing (release-please opens no pull request). Stable moves once a day at `stableAt` to a preview release
 * `soakHours` old. Times are wall-clock times in `zone`, read here rather than written as cron lines, because GitHub's
 * cron runs in UTC and never follows a zone's clock change; the workflows run hourly and ask these functions.
 */

export interface Channels {
  /** An IANA time zone, such as `Asia/Jerusalem`. */
  readonly zone: string;
  /** Each preview slot's start, in minutes after midnight in `zone`, ascending. */
  readonly previewSlots: readonly number[];
  /** When stable moves, in minutes after midnight in `zone`. */
  readonly stableAt: number;
  /** How long a preview release runs before stable may take it, in hours. */
  readonly soakHours: number;
}

export const CHANNELS_PATH = new URL('./channels.json', import.meta.url);

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = 24 * 60;
const MINUTE_MS = 60_000;

function clockMinutes(text: unknown, what: string): number {
  const match = typeof text === 'string' ? CLOCK.exec(text) : null;
  if (match === null) throw new Error(`channels.json: ${what} is not an HH:MM time`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function zoneOf(value: unknown): string {
  if (typeof value !== 'string' || value === '') throw new Error('channels.json: zone is not a time zone name');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw new Error(`channels.json: zone ${value} is not a time zone this Node knows`);
  }
  return value;
}

/** The channels' clock from channels.json's text; throws on any value of another shape, so a workflow fails closed. */
export function parseChannels(text: string): Channels {
  const body: unknown = JSON.parse(text);
  if (!isRecord(body)) throw new Error('channels.json: expected { "zone", "previewSlots", "stableAt", "soakHours" }');
  const slots = body['previewSlots'];
  if (!Array.isArray(slots) || slots.length === 0) throw new Error('channels.json: previewSlots is not a list of HH:MM times');
  const previewSlots = slots.map((slot, index) => clockMinutes(slot, `previewSlots[${index}]`));
  if (previewSlots.some((slot, index) => index > 0 && slot <= (previewSlots[index - 1] ?? -1))) {
    throw new Error('channels.json: previewSlots are not in ascending order');
  }
  const soakHours = body['soakHours'];
  if (typeof soakHours !== 'number' || !Number.isInteger(soakHours) || soakHours < 1 || soakHours > 24 * 7) {
    throw new Error(`channels.json: soakHours is not a whole number from 1 to ${24 * 7}`);
  }
  return { zone: zoneOf(body['zone']), previewSlots, stableAt: clockMinutes(body['stableAt'], 'stableAt'), soakHours };
}

export function readChannels(path: URL = CHANNELS_PATH): Channels {
  return parseChannels(readFileSync(path, 'utf8'));
}

/** Minutes after midnight that `now` shows on a clock in `zone`. */
export function minutesIn(now: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = (type: 'hour' | 'minute'): number => Number(parts.find((one) => one.type === type)?.value);
  return part('hour') * 60 + part('minute');
}

/** `HH:MM` of minutes after midnight. */
export function clockText(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The slot `now` falls in: the last slot start at or before `now` on the zone's clock, wrapping past midnight. */
export function currentSlot(now: Date, channels: Channels): number {
  const minutes = minutesIn(now, channels.zone);
  const started = channels.previewSlots.filter((slot) => slot <= minutes);
  return started[started.length - 1] ?? channels.previewSlots[channels.previewSlots.length - 1] ?? 0;
}

/** The slot after the one `now` falls in. */
export function nextSlot(now: Date, channels: Channels): number {
  const minutes = minutesIn(now, channels.zone);
  return channels.previewSlots.find((slot) => slot > minutes) ?? channels.previewSlots[0] ?? 0;
}

/**
 * The instant the slot `now` falls in started. Counted back on the zone's clock, then corrected once by what the clock
 * reads there, so a clock change inside the slot moves the start by its hour rather than leaving it an hour off.
 */
export function slotStart(now: Date, channels: Channels): Date {
  const slot = currentSlot(now, channels);
  const back = (minutesIn(now, channels.zone) - slot + DAY) % DAY;
  const minuteFloor = now.getTime() - (now.getTime() % MINUTE_MS);
  const guess = minuteFloor - back * MINUTE_MS;
  const off = ((minutesIn(new Date(guess), channels.zone) - slot + DAY + DAY / 2) % DAY) - DAY / 2;
  return new Date(guess - off * MINUTE_MS);
}

/**
 * Why a preview release may not merge at `now`, or null when it may: held only when a release already merged in the
 * slot `now` falls in. `lastMerge` is when the last release pull request merged, or null when none ever did.
 */
export function slotHold(now: Date, lastMerge: Date | null, channels: Channels): string | null {
  const start = slotStart(now, channels);
  if (lastMerge === null || lastMerge.getTime() < start.getTime()) return null;
  return `a preview release already merged in the ${clockText(currentSlot(now, channels))} slot: the next starts at ${clockText(nextSlot(now, channels))} ${channels.zone}`;
}

/** `slotHold` at a fixed `now`, as the release merge gate asks it with the last merge it read from GitHub. */
export function slotHoldAt(now: Date, channels: Channels): (lastMerge: Date | null) => string | null {
  return (lastMerge) => slotHold(now, lastMerge, channels);
}

/**
 * The instant stable last moved at or before `now`: today's `stableAt` on the zone's clock once it passed, else
 * yesterday's. The promote job measures the soak back from it, so every run from one `stableAt` to the next picks the
 * same release, and a late or repeated run changes nothing.
 */
export function stableStart(now: Date, channels: Channels): Date {
  return slotStart(now, { ...channels, previewSlots: [channels.stableAt] });
}
