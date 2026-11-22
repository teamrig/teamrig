import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { baselineText, compareCounts, readBaseline } from '../lib/count-baseline.ts';
import { EXIT_CLEAN, EXIT_FINDINGS } from '../lib/exit.ts';
import { takeRoot } from '../lib/repo-root.ts';
import { runMain } from '../lib/run-main.ts';
import { BASELINE_FILE, type SourceFile, boundaryCounts, boundaryFindings, findingLine, ruleCounts } from './boundaries.ts';

/** The folders whose TypeScript the boundaries hold. */
const FOLDERS = ['src', 'tools'] as const;
const BASELINE = 'tools/ci/boundaries.json';
const USAGE = 'usage: boundaries-cli.ts [--list] [--write] [--root <repo>]';

/** The `.ts` files under one folder of the repo, by their path from the repo root with `/` separators. */
function pathsUnder(root: string, folder: string): readonly string[] {
  const top = join(root, folder);
  if (!existsSync(top)) return [];
  return readdirSync(top, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

/** Every source file of the repo, sorted by its `/` path so each OS lists the findings in one order. */
function sourceFiles(root: string): readonly SourceFile[] {
  return FOLDERS.flatMap((folder) => [...pathsUnder(root, folder)].sort()).map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));
}

/**
 * Counts what crosses the layer boundaries of this repo (or `--root <repo>`), one line per rule, against the baseline
 * file, and fails when a count rose; `--list` prints each finding first, `--write` records the counts (a fall lowers
 * a baseline, a new rule adds one) and refuses a rise.
 */
async function main(args: readonly string[]): Promise<number> {
  const { root, rest } = takeRoot(args);
  const unknown = rest.filter((arg) => arg !== '--list' && arg !== '--write');
  if (unknown.length > 0) throw new Error(`unknown option ${unknown.join(' ')} (${USAGE})`);
  const findings = boundaryFindings(sourceFiles(root));
  if (rest.includes('--list')) {
    for (const finding of findings) console.log(findingLine(finding));
  }
  for (const line of boundaryCounts(findings)) console.log(`boundaries: ${line}`);
  const counts = ruleCounts(findings);
  const baseline = readBaseline(join(root, BASELINE), BASELINE_FILE.field);
  const { rose, fell, gone } = compareCounts(counts, baseline);
  for (const { key, count, baseline: was } of rose) console.log(`boundaries: ${key} rose to ${count} from ${was}: run --list to see each finding`);
  if (rest.includes('--write')) {
    if (rose.some(({ key }) => baseline.has(key))) {
      console.log('boundaries: wrote nothing: a count never rises');
      return EXIT_FINDINGS;
    }
    writeFileSync(join(root, BASELINE), baselineText(BASELINE_FILE.comment, BASELINE_FILE.field, counts));
    console.log(`boundaries: wrote ${BASELINE}`);
    return EXIT_CLEAN;
  }
  for (const { key, count, baseline: was } of fell) console.log(`boundaries: ${key} fell to ${count} from ${was}: run --write to lower its baseline`);
  for (const key of gone) console.log(`boundaries: ${key} is gone: run --write to drop its baseline`);
  console.log('boundaries: a count may fall, never rise');
  return rose.length > 0 ? EXIT_FINDINGS : EXIT_CLEAN;
}

process.exitCode = await runMain('boundaries', () => main(process.argv.slice(2)), (line) => console.error(line));
