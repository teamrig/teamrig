import { ENV, type Env } from './home.ts';

/**
 * Wall-clock limits on the child programs the kit starts (git, a smoke run of the built plugin), stretched by
 * `$TEAMRIG_TIME_SCALE`. The specs test what a limit does, not how fast the host is: on a CPU-bound host, 9 of 306
 * check runs failed only because a real git or node child ran past its limit, at nine different places (T5545). The
 * check sets the scale for the specs it runs; outside it nothing sets it, so every limit stays as written.
 * stopgap T5553: the lasting fix takes the host's load away (one guard process per tool call), then the scale goes.
 */

/** What the check sets: the slowest git query in those runs took 30 s, three times its 10 s limit. */
export const CHECK_TIME_SCALE = 4;

/** The largest scale read: a limit must still fire, so a typo such as 4000 cannot turn one off. */
export const MAX_TIME_SCALE = 20;

/**
 * The scale `env` sets, from 1 to {@link MAX_TIME_SCALE}; unset, blank, not a number or below 1 reads 1, so a scale
 * never shortens a limit, and one past the largest reads the largest.
 */
export function timeScale(env: Env): number {
  const raw = env[ENV.timeScale]?.trim();
  if (raw === undefined || raw === '') {
    return 1;
  }
  const scale = Number(raw);
  if (!Number.isFinite(scale) || scale < 1) {
    return 1;
  }
  return Math.min(scale, MAX_TIME_SCALE);
}

/** `limitMs` stretched by the scale `env` sets, in whole milliseconds. */
export function scaledLimitMs(limitMs: number, env: Env = process.env): number {
  return Math.round(limitMs * timeScale(env));
}

/** `env` with the check's scale added, unless it sets one already: a person's own scale wins. */
export function withCheckTimeScale(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return env[ENV.timeScale] === undefined ? { ...env, [ENV.timeScale]: String(CHECK_TIME_SCALE) } : env;
}
