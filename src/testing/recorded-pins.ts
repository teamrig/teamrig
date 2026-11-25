import { readdirSync, readFileSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transcriptLineOf } from '../budget/line.ts';
import { isRecord, stringField, type JsonRecord } from '../core/guards.ts';
import { CLIENT_MANIFEST, clientFileHash, clientManifestText, clientRootOf } from '../exec/client-integrity.ts';
import { APP, CliHarness, KIT, TEAM, USER_HOME, type RunOptions } from './cli-harness.ts';
import { FolderNames, withStrings } from './folder-names.ts';
import { MemoryTranscripts } from './memory-transcripts.ts';
import { hookMatches, pluginHooks, type WiredHook } from './plugin-hooks.ts';
import { quietWorld } from './quiet-world.ts';
import { hookFile, loadRecording, type RecordedHost, type Recording } from './recorded.ts';
import { shippedTranscripts } from './shipped-transcripts.ts';

/** The pinned file that holds what teamrig reads out of each recorded transcript. */
export const TRANSCRIPT_LINES_FILE = 'transcript-lines.json';

/** The pinned file that holds each guard's refusal of a recorded tool call, changed into one the guard refuses. */
export const GUARD_DENIES_FILE = 'guard-denies.json';

/** A guard and a tool call it refuses: the recorded session's first call of `tool`, with `toolInput` as its input. */
export interface GuardDeny {
  /** The guard's word after `hook`. */
  readonly guard: string;
  readonly tool: string;
  readonly toolInput: JsonRecord;
}

/**
 * One refusal for each guard the plugin wires to PreToolUse. Each goes through the real hook input of a recorded call,
 * the guard's hooks.json wiring and `hook <guard>`, so a bridge or wiring change that loses a refusal shows in the pin
 * where a guard's own specs, which build their input by hand and call it by name, would still pass.
 */
export const GUARD_DENIES: readonly GuardDeny[] = [
  { guard: 'push-guard', tool: 'Bash', toolInput: { command: 'git push --force origin main' } },
  { guard: 'package-guard', tool: 'Bash', toolInput: { command: 'npx eslint .' } },
  { guard: 'secret-guard', tool: 'Read', toolInput: { file_path: join(APP, '.env') } },
  { guard: 'db-write-guard', tool: 'PowerShell', toolInput: { command: 'psql -c "DELETE FROM orders"' } },
  { guard: 'exec-guard', tool: 'Bash', toolInput: { command: 'teamrig exec approve R1 --session owner' } },
  { guard: 'pass-record-guard', tool: 'Write', toolInput: { file_path: join(APP, '.git', 'local-ci', 'abc.json'), content: '{}' } },
  { guard: 'install-guard', tool: 'Edit', toolInput: { file_path: join(KIT, 'current.json'), old_string: '{', new_string: '{ ' } },
  { guard: 'service-role-guard', tool: 'Bash', toolInput: { command: 'teamrig roles grant github --holder alpha --yes' } },
  { guard: 'picker-guard', tool: 'Bash', toolInput: { command: 'cd sub && git status' } },
];

/** A guard's pinned answer to its changed call: the call's place among the recorded PreToolUse inputs, and each run. */
export interface PinnedDeny {
  readonly guard: string;
  readonly tool: string;
  /** The recorded input the call was made from, by its place among the PreToolUse inputs, from 0. */
  readonly index: number;
  /** The guard's runs for the call: one when hooks.json wires the guard to the tool, none when it does not. */
  readonly runs: readonly PinnedRun[];
}

/** What one wired hook did with one recorded input. */
export interface PinnedRun {
  readonly event: string;
  /** The input's place among its event's inputs, from 0. */
  readonly index: number;
  /** The words teamrig's CLI was run with. */
  readonly hook: string;
  readonly code: number;
  /** Each printed line; one that is a JSON object or list is kept parsed. */
  readonly stdout: readonly unknown[];
  readonly stderr: readonly string[];
}

/** The folder that holds the committed pins of `host`'s recording. */
export function expectedFolder(host: RecordedHost): string {
  return fileURLToPath(new URL(`./recorded/${host}/expected/`, import.meta.url));
}

/** The text of every file under `folder`, by its `/`-separated path there: pins as they are on disk. */
export function pinsIn(folder: string): Readonly<Record<string, string>> {
  const files: Record<string, string> = {};
  const read = (inside: string): void => {
    for (const entry of readdirSync(join(folder, inside), { withFileTypes: true })) {
      const path = inside === '' ? entry.name : `${inside}/${entry.name}`;
      if (entry.isDirectory()) {
        read(path);
      } else {
        files[path] = readFileSync(join(folder, path), 'utf8');
      }
    }
  };
  read('');
  return files;
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** `line` parsed when it is a JSON object or list, which is how a hook answers its host; undefined for any other text. */
function structured(line: string): unknown {
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) || Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What teamrig does today with the recorded session of `host`, as the pinned files by their path in the recording's
 * `expected/` folder: `hooks/<Event>.json` holds, for each of the event's inputs in firing order, what every hook the
 * plugin's hooks.json wires to it printed and exited with, `transcript-lines.json` what the usage meter reads out
 * of each transcript line, and `guard-denies.json` each guard's refusal of a recorded call (GUARD_DENIES). Every step that moves host code behind a port must leave these files as they are.
 *
 * The session is replayed through one CLI harness, so a hook sees the state the hooks before it left, as in the
 * recorded session. The harness's folders stand in for the recording's, and every folder is named by its placeholder
 * again in what is pinned, so the files are the same on every machine.
 */
export async function recordedPins(host: RecordedHost): Promise<Readonly<Record<string, string>>> {
  const names = new FolderNames({ cwd: APP, temp: resolve('/', 'tmp'), home: USER_HOME }, { '{{kit}}': KIT });
  const named = (text: string): string => names.named(text);
  const recording = loadRecording(host, names);
  const hooks = pluginHooks();
  const kit = new CliHarness({ ...TEAM, tabStatus: { enabled: true } });
  const env = { CLAUDE_PROJECT_DIR: APP, TEAMRIG_SESSION: 'alpha' };
  // Whole from the first input on: the real ones grew during the session, and the recording keeps only their end
  // state. A hook that builds a transcript's path itself spells it the platform's way, so each is found under both.
  const transcripts = new MemoryTranscripts();
  for (const { path, text } of recording.transcripts) {
    await kit.files.write(path, text);
    for (const spelled of new Set([path, normalize(path)])) {
      transcripts.set(spelled, text);
    }
  }
  const runs: PinnedRun[] = [];
  for (const { event, index, input } of recording.inputs) {
    for (const hook of hooks.filter((wired) => hookMatches(wired, input))) {
      runs.push(await pinnedRun(kit, hook, { event, index, input }, { env, transcripts }, named));
    }
  }
  const denies = await guardDenies(recording, hooks, env, named);
  const reader = shippedTranscripts();
  const lines = recording.transcripts.map(({ file, text }) => {
    const raw = text.split('\n').filter((line) => line !== '');
    const read = raw.flatMap((line, index) => {
      const value = transcriptLineOf(reader, line);
      return value === undefined ? [] : [{ line: index + 1, value: withStrings(value, named) }];
    });
    return { file, lines: raw.length, read };
  });
  return {
    ...Object.fromEntries(Object.keys(recording.recorded).map((event) => [hookFile(event), pretty(runs.filter((run) => run.event === event))])),
    [TRANSCRIPT_LINES_FILE]: pretty(lines),
    [GUARD_DENIES_FILE]: pretty(denies),
  };
}

/** What `hook` printed and exited with for the recorded `input`, its folders named by their placeholders. */
async function pinnedRun(
  kit: CliHarness,
  hook: WiredHook,
  { event, index, input }: { readonly event: string; readonly index: number; readonly input: JsonRecord },
  options: Pick<RunOptions, 'env' | 'transcripts' | 'platform'>,
  named: (text: string) => string,
): Promise<PinnedRun> {
  // The guard hooks run through `hook <name>` like every other, without the guard runner's worker thread: the pin is
  // what a hook decides, and the runner has its own specs.
  const result = await kit.run(hook.argv, { ...options, stdin: JSON.stringify(input) });
  return {
    event,
    index,
    hook: hook.argv.join(' '),
    code: result.code,
    // Folders are named in a parsed line's values: in its raw text a path would take a following `\n` escape for a
    // segment of its own.
    stdout: result.stdout.map((line) => {
      const value = structured(line);
      return value === undefined ? named(line) : withStrings(value, named);
    }),
    stderr: result.stderr.map(named),
  };
}

/**
 * Each of GUARD_DENIES run on a harness of its own, so no refusal leaves state the session's replay would read. The
 * team turns the picker guard on, and the plugin's client is installed as its build wrote it, so the exec guard refuses
 * the review for what it names, not for a client it cannot check.
 */
async function guardDenies(recording: Recording, hooks: readonly WiredHook[], env: Readonly<Record<string, string>>, named: (text: string) => string): Promise<readonly PinnedDeny[]> {
  const kit = new CliHarness({ ...TEAM, pickerGuard: { enabled: true } });
  const launcher = '#!/bin/sh\nexec node main.js\n';
  const plugin = clientRootOf(quietWorld().self.script);
  await kit.files.write(join(plugin, CLIENT_MANIFEST), clientManifestText(new Map([['bin/teamrig', clientFileHash(launcher)]])));
  await kit.files.write(join(plugin, 'bin', 'teamrig'), launcher);
  const calls = recording.inputs.filter(({ event }) => event === 'PreToolUse');
  const pinned: PinnedDeny[] = [];
  for (const { guard, tool, toolInput } of GUARD_DENIES) {
    const recorded = calls.find(({ input }) => stringField(input, 'tool_name') === tool);
    if (recorded === undefined) {
      throw new Error(`the recording has no ${tool} call to make the ${guard} refusal from`);
    }
    const input: JsonRecord = { ...recorded.input, tool_input: toolInput };
    const runs: PinnedRun[] = [];
    for (const hook of hooks.filter((wired) => hookMatches(wired, input) && wired.argv[1] === guard)) {
      // The install guard reads a written path as this platform spells it, as `join` built the kit's path here.
      runs.push(await pinnedRun(kit, hook, { event: recorded.event, index: recorded.index, input }, { env, platform: process.platform }, named));
    }
    pinned.push({ guard, tool, index: recorded.index, runs });
  }
  return pinned;
}
