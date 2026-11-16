/**
 * How node, tsx and ts-node read their options, so every guard that looks for the script or code a run starts reads
 * them alike: the db-write guard for the writes a script makes, the secret guard for the saved credentials it reads.
 */

/** Options of node, tsx and ts-node that take the next word as their value. */
export const NODE_VALUED: ReadonlySet<string> = new Set([
  '-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions', '--input-type', '--title',
  '--env-file', '--tsconfig', '-P', '--project', '-O', '--compiler-options', '--compiler', '--cwd',
]);

/** Options of node, tsx and ts-node whose next word is code to run. */
export const NODE_CODE: ReadonlySet<string> = new Set(['-e', '--eval', '-p', '--print']);

/** Options that make node, tsx or ts-node run no script: a test run, a syntax check, its version or help. */
export const NODE_NO_SCRIPT: ReadonlySet<string> = new Set(['--test', '--check', '-c', '--version', '-v', '--help', '-h']);
