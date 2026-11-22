import { parseArgs } from 'node:util';
import { EXIT_CLEAN, EXIT_USAGE } from '../lib/exit.ts';
import { createGit } from '../lib/git.ts';
import { runMain } from '../lib/run-main.ts';
import { readChannels } from './channels.ts';
import { promote, readHold } from './promote.ts';

/**
 * Run hourly and by hand by .github/workflows/release-promote.yml in a checkout of main whose remote takes the
 * deploy key's push (T5133): promotes a preview release to stable (promote.ts). `--hotfix-tag` and `--hotfix-sha`
 * together promote that tag at once; both empty, as a scheduled run passes them, is the scheduled pick.
 */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      'hotfix-tag': { type: 'string', default: '' },
      'hotfix-sha': { type: 'string', default: '' },
      remote: { type: 'string', default: 'origin' },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const [tag, sha] = [values['hotfix-tag'], values['hotfix-sha']];
  if ((tag === '') !== (sha === '')) {
    console.log('promote: pass --hotfix-tag <v<version>> and --hotfix-sha <its commit> together, or neither');
    return EXIT_USAGE;
  }
  const hotfix = tag === '' ? undefined : { tag, sha };
  const promotion = { remote: values.remote, channels: readChannels(), held: readHold(), now: new Date(), hotfix, dryRun: values['dry-run'] };
  await promote(createGit(process.cwd()), promotion, console.log);
  return EXIT_CLEAN;
}

process.exitCode = await runMain('promote', main, console.error);
