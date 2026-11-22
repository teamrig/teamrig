import { join, posix, win32 } from 'node:path';
import { formatConfig, writeConfigWithBackup } from '../../config/load.ts';
import { errorMessage, type JsonRecord } from '../../core/guards.ts';
import { resolveKitHome } from '../../core/home.ts';
import { noPositionals, requiredFlag, type ParsedArgs } from '../args.ts';
import { readClaudeSettings } from '../claude-settings.ts';
import { userHooksOf } from '../host.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';

/**
 * `setup hooks --host <name> [--yes]`: puts teamrig's hooks into the person's own hooks file of a host that loads no
 * plugin's hooks (Codex CLI), beside the person's own handlers, which stay as they are. teamrig's earlier handlers
 * are replaced, so the same command after an update rewrites them. Without --yes it only counts what would be
 * inserted, unchanged, changed and removed; with it, the old file is kept in the kit's backups folder first. It never
 * writes the host's trust in a handler: the person gives that in the host, after every write.
 */

/** The plugin's entry script, below its root: `<root>/dist/cli/main.js`. */
const ENTRY_FOLDERS: readonly string[] = ['dist', 'cli'];
const ENTRY_SCRIPT = 'main.js';
/** The plugin's own hooks file, below its root. */
const PLUGIN_HOOKS: readonly string[] = ['hooks', 'hooks.json'];

/** `setup hooks --host <name> [--yes]`. */
export async function hooks(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  noPositionals(args);
  const port = userHooksOf(runtime, requiredFlag(args.flags, 'host'));
  const path = runtime.platform === 'win32' ? win32 : posix;
  const pluginRoot = pluginRootOf(runtime.self.script, path);
  const source = await pluginHooks(runtime, path.join(pluginRoot, ...PLUGIN_HOOKS));
  const target = port.file(runtime.userHome);
  const current = await readClaudeSettings(runtime, target);
  const answer = port.merge(current.json, source, pluginRoot);
  if (!answer.ok) {
    throw new RefusedError(`${answer.problem}; nothing written`);
  }
  const { file, counts, skipped } = answer.value;
  const counted = `inserted ${counts.inserted}, unchanged ${counts.unchanged}, changed ${counts.changed}, removed ${counts.removed}`;
  const write = args.switches.has('yes');
  if (file === undefined) {
    runtime.out.stdout(`UNCHANGED ${target}: teamrig's hooks are already in it (${counted})`);
  } else if (!write) {
    runtime.out.stdout(`PREVIEW nothing written (add --yes to write) ${target}: ${counted}`);
  } else {
    const backup = await written(runtime, target, current.exists, port.host, file);
    runtime.out.stdout(`WROTE ${target}: ${counted}${backup === undefined ? '' : `; the old file is at ${backup}`}`);
  }
  skipped.forEach((line) => runtime.out.stdout(`  SKIPPED ${line}`));
  if (file !== undefined) {
    port.afterWrite.forEach((line) => runtime.out.stdout(`  NOTE ${line}`));
  }
  return EXIT.ok;
}

/**
 * The installed plugin's root, from this CLI's entry script. A run from the source tree, or any script but the
 * plugin's built entry, has no installed hooks to point the host at, so it is refused.
 */
function pluginRootOf(script: string, path: typeof posix): string {
  const cli = path.dirname(script);
  const dist = path.dirname(cli);
  if (path.basename(script) !== ENTRY_SCRIPT || [path.basename(dist), path.basename(cli)].join('/') !== ENTRY_FOLDERS.join('/')) {
    throw new RefusedError(`setup hooks runs from the installed plugin's dist/cli/main.js, not ${script}, so the host runs the installed teamrig; nothing written`);
  }
  return path.dirname(dist);
}

async function pluginHooks(runtime: CliRuntime, file: string): Promise<unknown> {
  const text = await runtime.files.read(file);
  if (text === undefined) {
    throw new RefusedError(`the plugin's hooks file ${file} is missing; nothing written`);
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch (error) {
    throw new RefusedError(`the plugin's hooks file ${file} is not valid JSON (${errorMessage(error)}); nothing written`);
  }
}

/** Writes the merged file, keeping the old one first when there was one; returns where it was kept. */
async function written(runtime: CliRuntime, target: string, existed: boolean, host: string, file: JsonRecord): Promise<string | undefined> {
  if (!existed) {
    await runtime.files.write(target, formatConfig(file));
    return undefined;
  }
  const backupsDir = join(resolveKitHome(runtime.env, runtime.userHome), 'backups');
  return writeConfigWithBackup(runtime.files, { configPath: target, backupsDir, backupName: `${host}-hooks` }, file, runtime.clock);
}
