import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { EXIT_CLEAN, EXIT_USAGE } from '../lib/exit.ts';
import { createGit } from '../lib/git.ts';
import { MARKETPLACE } from '../lib/marketplace.ts';
import { runMain } from '../lib/run-main.ts';
import { publishRelease, type Files } from './publish.ts';

/** Run by the release workflow's publish job, in a checkout of the release's source with the dist built in it. */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      source: { type: 'string' },
      branch: { type: 'string', default: 'release' },
      seed: { type: 'string' },
      dist: { type: 'string', default: 'plugins/teamrig/dist' },
      remote: { type: 'string', default: 'origin' },
      marketplace: { type: 'string', default: MARKETPLACE },
    },
    strict: true,
    allowPositionals: false,
  });
  const { version, source, branch, seed, dist, remote, marketplace } = values;
  if (version === undefined || source === undefined) {
    console.log('release: pass --version <MAJOR.MINOR.PATCH> and --source <main commit sha> [--branch <name> --seed <branch it starts from>]');
    return EXIT_USAGE;
  }
  const root = process.cwd();
  const files: Files = { read: (path) => readFileSync(join(root, path), 'utf8'), write: (path, text) => writeFileSync(join(root, path), text) };
  await publishRelease(createGit(root), files, { version, source, branch, seed, dist, remote, marketplace }, (line) => console.log(line));
  return EXIT_CLEAN;
}

process.exitCode = await runMain('release', main, (line) => console.error(line));
