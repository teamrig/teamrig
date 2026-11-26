import type { NodeEntry } from './node-main.ts';

/**
 * The fail-closed runner around teamrig's guard hooks (T1818). Claude Code lets a tool call through when a PreToolUse
 * command hook exits with anything but 0 or 2, or outlives its timeout, so a guard that cannot load, throws, hangs or
 * prints something other than its answer stops guarding with no sign. The runner turns each of those into exit 2,
 * which blocks the call and shows the model a line naming the guard, what went wrong and the fix.
 *
 * It imports nothing at run time (the import above is a type), so the code that can break under it is the CLI it loads.
 * The time limit fires only while this thread is free: guard-main.ts runs the CLI on a worker thread (guard-thread.ts,
 * T2433), so a guard stuck in synchronous work is blocked at the limit too. Not caught: the process running out of
 * memory, a broken runner or entry script, and a missing Node.js.
 */

/**
 * How long a guard may run before the runner blocks the call. Under hooks.json's 15 s for the guards, so the runner
 * answers before Claude Code's timeout, which would let the call through; the margin covers Node.js starting.
 */
export const GUARD_LIMIT_MS = 12_000;

/**
 * The CLI run the runner loads and judges: `runWithNode` in `node-main.ts`, run on the guard thread. Its exit code is
 * a plain number, since it comes back across the thread and the runner judges any code.
 */
export type GuardMain = (argv: readonly string[], entry: NodeEntry) => Promise<number>;

/** What a guard run ended with. */
export type GuardOutcome =
  | { readonly kind: 'answered'; readonly code: number; readonly stdout: readonly string[] }
  | { readonly kind: 'load-failed'; readonly cause: unknown }
  | { readonly kind: 'crashed'; readonly cause: unknown }
  | { readonly kind: 'timed-out'; readonly limitMs: number }
  | { readonly kind: 'not-a-hook'; readonly argv: readonly string[] };

/** What the runner tells Claude Code. */
export interface GuardVerdict {
  /** 0 passes the guard's answer on; 2 blocks the tool call. */
  readonly exitCode: 0 | 2;
  /** The answer Claude Code reads on exit 0: nothing, or the guard's one JSON object. */
  readonly stdout: string;
  /** Why the call is blocked, which Claude Code shows the model on exit 2; empty when the answer passes on. */
  readonly stderr: string;
}

/** What the runner takes from the process; `guard-main.ts` gives it the real one. */
export interface GuardHost {
  /** Calls `listener` on an uncaught exception or an unhandled rejection. */
  onFatal(listener: (cause: unknown) => void): void;
  /** Calls `fire` after `ms`, holding the process open until then; `release` stops the holding, not the call. */
  startLimit(ms: number, fire: () => void): { readonly release: () => void };
  write(text: string): void;
  writeError(text: string): void;
  /** Ends the process now. */
  exit(code: number): void;
  /** The code the process ends with once its work drains. */
  setExitCode(code: number): void;
  /** The hook's input, the process's whole stdin. */
  readStdin(): Promise<string>;
}

/** What a thrown value says, on one line. */
function causeText(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  return text.split(/\r?\n/, 1)[0] ?? '';
}

/** Whether `text` is one JSON object, the only answer a guard prints besides nothing. */
function isJsonObject(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

const UPDATE_FIX = 'update the teamrig plugin and restart the session; if that does not clear it, tell your lead.';
const SLOW_FIX = 'retry the call; if every call times out, the host is overloaded or the guard hangs: tell your lead.';
/** The most of a wrong answer the block line quotes. */
const QUOTE_CHARS = 200;

function blocked(subject: string, what: string, fix: string): GuardVerdict {
  return {
    exitCode: 2,
    stdout: '',
    stderr: `teamrig blocked this call: its ${subject} ${what}, and a guard that cannot answer must not let a call through. Fix: ${fix}\n`,
  };
}

/** The verdict on a guard run: its answer passed on, or the call blocked. `subject` names what ran, as `guardSubject` words it. */
export function judgeGuard(subject: string, outcome: GuardOutcome): GuardVerdict {
  switch (outcome.kind) {
    case 'load-failed':
      return blocked(subject, `could not load (${causeText(outcome.cause)})`, UPDATE_FIX);
    case 'crashed':
      return blocked(subject, `crashed (${causeText(outcome.cause)})`, UPDATE_FIX);
    case 'timed-out':
      return blocked(subject, `gave no answer within ${outcome.limitMs / 1000} s`, SLOW_FIX);
    case 'not-a-hook':
      return {
        exitCode: 2,
        stdout: '',
        stderr: `teamrig blocked this run: the guard entry runs only \`hook <name>\` or \`hook guards <name> ...\`, never ${JSON.stringify(outcome.argv.join(' ').slice(0, QUOTE_CHARS))}; run other commands through \`teamrig\`.\n`,
      };
    case 'answered':
      break;
  }
  const text = outcome.stdout.join('\n');
  if (outcome.code === 2) {
    // The guard's own block: Claude Code shows stderr then, not stdout, so what it printed moves there.
    return { exitCode: 2, stdout: '', stderr: text.trim() === '' ? '' : `${text}\n` };
  }
  if (outcome.code !== 0) {
    return blocked(subject, `ended with exit ${outcome.code}`, UPDATE_FIX);
  }
  if (text.trim() === '') {
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  if (!isJsonObject(text)) {
    return blocked(subject, `printed something other than its JSON answer (${JSON.stringify(text.slice(0, QUOTE_CHARS))})`, UPDATE_FIX);
  }
  return { exitCode: 0, stdout: `${text}\n`, stderr: '' };
}

/**
 * The hooks hooks.json runs through the guard entry one by one, and so the only names `hook <name>` takes there
 * (guard-hooks.test.ts holds them to hooks.json and to an earlier setup's Codex lines): any other hook would run through
 * an entry no guard expects it in (T3069). The set's guards stay here too: a Codex CLI hooks file an earlier setup wrote
 * still runs each alone until the next setup rewrites it, and a guard the runner refused would block every call.
 */
export const GUARD_HOOKS: ReadonlySet<string> = new Set([
  'push-guard',
  'package-guard',
  'secret-guard',
  'db-write-guard',
  'exec-guard',
  'pass-record-guard',
  'install-guard',
  'service-role-guard',
  'cold-send',
  'helper-gate',
  'picker-guard',
]);

/** The hook that runs several guards on one call in one CLI load (T5553): `hook guards <name> ...`. */
export const GUARD_SET_HOOK = 'guards';

/**
 * The guards `hook guards` may name (hook-guard-set.ts `SET_GUARD_REPLIES`, not imported: see above; its spec holds
 * the two equal).
 */
export const SET_GUARDS: ReadonlySet<string> = new Set([
  'push-guard',
  'package-guard',
  'secret-guard',
  'db-write-guard',
  'exec-guard',
  'pass-record-guard',
  'install-guard',
  'service-role-guard',
]);

/** The flag naming the host a hook line runs in (args.ts `HOST_FLAG`, not imported: see above). */
const HOST_FLAG = '--host';
/** A host's adapter id as hooks lines write it: lowercase words joined by hyphens, such as `claude-code`. */
const HOST_ID_WORD = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
/** The flag a host whose hook input names no event writes after the hook (args.ts `HOST_EVENT_FLAG`, not imported: see above). */
const HOST_EVENT_FLAG = '--host-event';
/** A host's hook event name as its hooks file writes it: letters only, such as `PreToolUse`. */
const HOST_EVENT_WORD = /^[A-Za-z]+$/u;

/** The flags a hook line may carry after the guard's name, each with the shape its value must have. */
const HOOK_FLAGS: ReadonlyMap<string, RegExp> = new Map([
  [HOST_FLAG, HOST_ID_WORD],
  [HOST_EVENT_FLAG, HOST_EVENT_WORD],
]);

/**
 * The guards a guard hook line names, in its order, and the words after them; undefined when it names none the entry
 * runs: `hook <name>` for one, `hook guards <name> ...` for a set, at least one and each once.
 */
function guardsOf(argv: readonly string[]): { readonly guards: readonly string[]; readonly flags: readonly string[] } | undefined {
  const [group, name, ...after] = argv;
  if (group !== 'hook' || name === undefined) {
    return undefined;
  }
  if (name !== GUARD_SET_HOOK) {
    return GUARD_HOOKS.has(name) ? { guards: [name], flags: after } : undefined;
  }
  const end = after.findIndex((word) => word.startsWith('--'));
  const guards = end === -1 ? after : after.slice(0, end);
  const named = guards.length > 0 && new Set(guards).size === guards.length && guards.every((guard) => SET_GUARDS.has(guard));
  return named ? { guards, flags: after.slice(guards.length) } : undefined;
}

/** Whether `flags` are at most `--host <id>` and `--host-event <event>`, each once and in either order. */
function hookFlagsOk(flags: readonly string[]): boolean {
  if (flags.length % 2 !== 0) {
    return false;
  }
  const seen = new Set<string>();
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index] ?? '';
    const shape = HOOK_FLAGS.get(flag);
    const value = flags[index + 1] ?? '';
    if (shape === undefined || seen.has(flag) || !shape.test(value)) {
      return false;
    }
    seen.add(flag);
  }
  return true;
}

/**
 * Whether `argv` is `hook <name>` for a guard hook, or `hook guards <name> ...` for a set of them, with at most
 * `--host <id>` and `--host-event <event>` after it, each once and in either order, and nothing else. The guard entry
 * loads the whole CLI, so any other words would run a CLI command no guard reads as one (`node
 * <plugin>/dist/cli/guard-main.js roles grant ...`, T3069).
 */
export function isHookArgv(argv: readonly string[]): boolean {
  const named = guardsOf(argv);
  return named !== undefined && hookFlagsOk(named.flags);
}

/** What a block line calls the guard hook `argv` runs: `push-guard guard` for one, `guards a, b and c` for a set. */
export function guardSubject(argv: readonly string[]): string {
  const guards = guardsOf(argv)?.guards ?? [];
  if (argv[1] !== GUARD_SET_HOOK) {
    return `${guards[0] ?? argv[1] ?? 'hook'} guard`;
  }
  const last = guards.at(-1) ?? '';
  return guards.length <= 1 ? `guards ${last}` : `guards ${guards.slice(0, -1).join(', ')} and ${last}`;
}

/**
 * Runs the guard `hook <name>`, or the set `hook guards <name> ...`, that `argv` names, and blocks any other argv before
 * it loads anything: loads the CLI with `load` once, runs it with its stdout kept back, and
 * tells Claude Code the verdict. The first outcome decides; once the answer is out, the process may finish its work
 * until the limit, then ends with the verdict's code, so Claude Code's timeout never drops a given answer.
 */
export async function runGuard(argv: readonly string[], script: string, load: () => Promise<GuardMain>, host: GuardHost, limitMs = GUARD_LIMIT_MS): Promise<void> {
  if (!isHookArgv(argv)) {
    const refused = judgeGuard('entry', { kind: 'not-a-hook', argv });
    host.writeError(refused.stderr);
    host.exit(refused.exitCode);
    return;
  }
  const subject = guardSubject(argv);
  let verdict: GuardVerdict | undefined;
  const settle = (outcome: GuardOutcome): GuardVerdict => {
    if (verdict !== undefined) {
      return verdict;
    }
    const judged = judgeGuard(subject, outcome);
    if (judged.stdout !== '') {
      host.write(judged.stdout);
    }
    if (judged.stderr !== '') {
      host.writeError(judged.stderr);
    }
    verdict = judged;
    return judged;
  };
  const end = (outcome: GuardOutcome): void => host.exit(settle(outcome).exitCode);
  host.onFatal((cause) => end({ kind: 'crashed', cause }));
  const limit = host.startLimit(limitMs, () => end({ kind: 'timed-out', limitMs }));

  let main: GuardMain;
  try {
    main = await load();
  } catch (cause) {
    end({ kind: 'load-failed', cause });
    return;
  }
  const stdout: string[] = [];
  const entry: NodeEntry = { out: { stdout: (line) => stdout.push(line), stderr: (line) => host.writeError(`${line}\n`) }, script, readStdin: () => host.readStdin() };
  try {
    const code = await main(argv, entry);
    host.setExitCode(settle({ kind: 'answered', code, stdout }).exitCode);
    limit.release();
  } catch (cause) {
    end({ kind: 'crashed', cause });
  }
}
