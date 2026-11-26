import { join } from 'node:path';
import { FIND_TEAMRIG_CLI, TEAMRIG_NOT_FOUND } from '../core/launcher-script.ts';
import { STEP_HANDOFF_VAR } from './step-handoff.ts';

/** The session launcher's place under the kit home: `<kit home>/bin/session-launch.mjs`. */
export function sessionLauncherPath(kitHome: string): string {
  return join(kitHome, 'bin', 'session-launch.mjs');
}

/** The pipe a step hands its plan on: the first one past stdin, stdout and stderr. */
const HANDOFF_PIPE = 3;

/**
 * The session launcher `teamrig open` writes and names as a tab's first process (T5757). A tab's launch used to hold
 * the whole CLI in memory for the session's life, an old version's too after an update; this small script is all
 * that stays. It runs `teamrig launch ... --step` once per start, found afresh each time (FIND_TEAMRIG_CLI), so a
 * restart runs the newest install. A step that hands a plan on the pipe `$TEAMRIG_STEP_HANDOFF` names gets it run
 * here, in the tab, and the next step is told how it ended (`--ended exited:<code>|missing|failed:<why>
 * --started-at <ms>`); a step that hands none ends the tab with its exit. Ctrl+C reaches every process in the
 * terminal: the host program handles it, and this script ignores it for life, as the tab ends when it does. The
 * plan's program starts without `$TEAMRIG_STEP_HANDOFF`, so nothing it starts writes to a pipe of this script's.
 * The text carries no kit version, so an update leaves it alone.
 */
export const SESSION_LAUNCHER_SCRIPT = String.raw`// Written by "teamrig open": the first process of a session's tab. It runs each start's
// "teamrig launch --step" and the program that step names, so the CLI does not stay in memory.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

${FIND_TEAMRIG_CLI}

const HANDOFF_VAR = ${JSON.stringify(STEP_HANDOFF_VAR)};
const HANDOFF_PIPE = ${HANDOFF_PIPE};
process.on('SIGINT', () => {});

const isStrings = (value) => Array.isArray(value) && value.every((word) => typeof word === 'string');
const isPlan = (value) =>
  typeof value === 'object' && value !== null && typeof value.command === 'string' && isStrings(value.args) && typeof value.cwd === 'string' &&
  typeof value.env === 'object' && value.env !== null && Object.values(value.env).every((text) => typeof text === 'string');

/** Runs one step; resolves to its exit code and the plan it handed on, if any. */
function step(main, words) {
  return new Promise((resolve) => {
    const stdio = ['inherit', 'inherit', 'inherit'];
    stdio[HANDOFF_PIPE] = 'pipe';
    let child;
    try {
      // Shown on purpose: the step runs in this tab, on its console, where it prints a refusal or the start line.
      child = spawn(process.execPath, [main, ...words], { stdio, env: { ...process.env, [HANDOFF_VAR]: String(HANDOFF_PIPE) } });
    } catch (error) {
      resolve({ code: 1, problem: 'teamrig launch did not start: ' + error.message });
      return;
    }
    let handed = '';
    child.stdio[HANDOFF_PIPE].setEncoding('utf8');
    child.stdio[HANDOFF_PIPE].on('data', (chunk) => { handed += chunk; });
    child.once('error', (error) => resolve({ code: 1, problem: 'teamrig launch did not start: ' + error.message }));
    child.once('close', (code) => {
      if (code !== 0 || handed === '') {
        resolve({ code: code ?? 1 });
        return;
      }
      let plan;
      try {
        plan = JSON.parse(handed);
      } catch {}
      resolve(isPlan(plan) ? { code: 0, plan } : { code: 1, problem: 'teamrig launch handed on a start that is not one' });
    });
  });
}

/** Runs the host program a step named in this tab; resolves to how it ended, as --ended spells it. */
function host(plan) {
  return new Promise((resolve) => {
    const env = { ...plan.env };
    delete env[HANDOFF_VAR];
    const ended = (error) => resolve(error.code === 'ENOENT' ? 'missing' : 'failed:' + error.message);
    let child;
    try {
      // Shown on purpose: the program runs in this tab, on its console.
      child = spawn(plan.command, plan.args, { cwd: plan.cwd, env, stdio: 'inherit' });
    } catch (error) {
      ended(error);
      return;
    }
    child.once('error', ended);
    child.once('exit', (code) => resolve('exited:' + (code ?? 1)));
  });
}

const words = process.argv.slice(2);
let ended = [];
for (;;) {
  const main = teamrigCli();
  if (main === undefined) {
    console.log('FAILED: ' + ${JSON.stringify(TEAMRIG_NOT_FOUND)});
    process.exitCode = 1;
    break;
  }
  const done = await step(main, [...words, '--step', ...ended]);
  if (done.problem !== undefined) {
    console.log('FAILED: ' + done.problem);
  }
  if (done.plan === undefined) {
    process.exitCode = done.code;
    break;
  }
  const startedAt = Date.now();
  ended = ['--ended', await host(done.plan), '--started-at', String(startedAt)];
}
`;
