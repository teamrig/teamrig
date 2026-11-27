import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EXIT_CLEAN, EXIT_FINDINGS, EXIT_USAGE } from '../lib/exit.ts';
import { createGit } from '../lib/git.ts';
import { runMain } from '../lib/run-main.ts';
import { isRecord, stringField } from '../lib/guards.ts';
import { adapterFindings, builtAdapterSides } from './adapter-smoke.ts';
import { launcherModeFinding, smokeDist, type Runner } from './dist-smoke.ts';
import { spawnRun } from './spawn-run.ts';
import { scaledLimitMs, withCheckTimeScale } from '../../src/core/time-limit.ts';

const PLUGIN_ROOT = resolve('plugins', 'teamrig');

/** The limit on one run of the built plugin, as written; the check's time scale stretches it. */
const SPAWN_TIMEOUT_MS = 15_000;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Runs the committed dist as an installed plugin, in team `smoke` with an empty kit home. */
async function main(): Promise<number> {
  const plugin = readJson(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'));
  const version = isRecord(plugin) ? stringField(plugin, 'version') : undefined;
  if (version === undefined) {
    console.log('dist-smoke: plugin.json has no version');
    return EXIT_USAGE;
  }
  const home = mkdtempSync(join(tmpdir(), 'teamrig-smoke-'));
  try {
    // The smoke times the built hooks on the check's loaded host, so its limit and theirs take the check's time scale.
    const env = withCheckTimeScale({ ...process.env, TEAMRIG_HOME: home, TEAMRIG_TEAM: 'smoke' });
    const run: Runner = (request) => spawnRun(request, { env, cwd: home, timeout: scaledLimitMs(SPAWN_TIMEOUT_MS, env) });
    const findings = smokeDist(
      {
        platform: process.platform,
        pluginRoot: PLUGIN_ROOT,
        manifest: readJson(join(PLUGIN_ROOT, 'hooks', 'hooks.json')),
        version,
        nodePath: process.execPath,
        comspec: process.env['ComSpec'] ?? 'cmd.exe',
      },
      run,
    );
    const mode = await launcherModeFinding(createGit(process.cwd()));
    if (mode !== undefined) {
      findings.push(mode);
    }
    const adapters = await builtAdapterSides(PLUGIN_ROOT);
    findings.push(...('finding' in adapters ? [adapters.finding] : await adapterFindings(adapters.sides)));
    if (findings.length === 0) {
      console.log(`dist-smoke: the launcher, every hook and every adapter run from the dist on ${process.platform}`);
      return EXIT_CLEAN;
    }
    console.log(`dist-smoke: ${findings.length} problem(s) on ${process.platform}:`);
    findings.forEach((finding) => console.log(`  ${finding}`));
    return EXIT_FINDINGS;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

process.exitCode = await runMain('dist-smoke', main, (line) => console.error(line));
