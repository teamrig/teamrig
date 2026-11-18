import { posix, win32 } from 'node:path';
import type { DeliveryConfig } from '../config/types.ts';
import type { TeamPaths } from '../core/home.ts';
import { LEDGER_FILE } from '../delivery/ledger.ts';
import { deliveryDirOf, DETACHED_DIR, hostLockOf } from '../delivery/places.ts';
import { PIPELINE_FREEZES_FILE, PIPELINE_FREEZES_LOCK_FILE } from '../delivery/pipeline-freezes.ts';
import type { EditCall, HookEvent, HookReply } from '../ports/host/index.ts';
import { refusal } from './permission.ts';

/**
 * The delivery write guard (T4265): the queue runs what its own files say (a parked step is a command line, the
 * detached run records, the host lock and its line, the ledger it learns memory needs from), so only the teamrig CLI
 * writes them. The guard refuses a session's file tool writing one: anything in the detached folder (the parked steps
 * with it), the ledger, the host lock and the files beside it named after it, and the pipeline freezes. It reads only
 * the call, so a shell line or a script still reaches them; the queue checks a parked step's words again before it
 * runs (queue-step-guards.ts). The hand-written ledger.md stays open.
 */

/** The places of one team only the teamrig CLI writes, each as `placeOf` compares it. */
export interface DeliveryWritePlaces {
  /** Folders refused with everything in them. */
  readonly folders: readonly string[];
  /** Files refused by their own name. */
  readonly files: readonly string[];
  /** Files refused with every file beside them named `<file>.<more>` (the host lock's line, tabs, turns). */
  readonly stems: readonly string[];
}

/** A path as the guard compares it: one slash, `.` and `..` resolved, any case (Windows paths are case-blind). */
function placeOf(path: string): string {
  return posix.normalize(path.replaceAll('\\', '/')).replace(/\/+$/, '').toLowerCase();
}

/** The team's delivery places the guard refuses, from its delivery config (the defaults when it has none). */
export function deliveryWritePlacesOf(delivery: Pick<DeliveryConfig, 'dir'> & { readonly queue: Pick<DeliveryConfig['queue'], 'lockPath'> }, paths: Pick<TeamPaths, 'home' | 'state' | 'kitHome'>): DeliveryWritePlaces {
  const dir = deliveryDirOf(delivery, paths);
  const hostLock = hostLockOf(delivery.queue, paths);
  const lockDir = win32.dirname(hostLock);
  return {
    folders: [placeOf(win32.join(dir, DETACHED_DIR))],
    files: [win32.join(dir, LEDGER_FILE), win32.join(lockDir, PIPELINE_FREEZES_FILE), win32.join(lockDir, PIPELINE_FREEZES_LOCK_FILE)].map(placeOf),
    stems: [placeOf(hostLock)],
  };
}

/** Whether `path` is one of `places`. */
export function isDeliveryPlace(path: string, places: DeliveryWritePlaces): boolean {
  const place = placeOf(path);
  return (
    places.folders.some((folder) => place.startsWith(`${folder}/`)) ||
    places.files.includes(place) ||
    places.stems.some((stem) => place === stem || place.startsWith(`${stem}.`))
  );
}

/** The event's file-tool call, the only kind the guard reads; undefined for any other call. */
function editCallOf(event: HookEvent): EditCall | undefined {
  const { call } = event;
  return call?.kind === 'edit' ? call : undefined;
}

/** Whether the call is a file tool's write of a named file: any other call needs no team config. */
export function writesAFile(event: HookEvent): boolean {
  return editCallOf(event)?.files.some(({ path }) => path !== undefined) ?? false;
}

/** A written path as the guard reads it: a relative one from the call's folder. */
function absoluteOf(path: string, cwd: string | undefined): string {
  return win32.isAbsolute(path) || posix.isAbsolute(path) || cwd === undefined ? path : `${cwd}/${path}`;
}

/** What in the call writes a delivery file, for the reason; undefined when nothing does. */
export function deliveryWriteReach(event: HookEvent, places: DeliveryWritePlaces): string | undefined {
  const call = editCallOf(event);
  const written = call?.files.find(({ path }) => path !== undefined && isDeliveryPlace(absoluteOf(path, event.cwd), places));
  return call === undefined || written?.path === undefined ? undefined : `this ${call.name} writes ${written.path}, a file of the delivery queue`;
}

/** Why the call is refused, with what to do instead. */
export function deliveryWriteReason(reach: string): string {
  return (
    `teamrig delivery guard: ${reach}. Only the teamrig CLI writes the queue's files (its parked and detached runs, ` +
    "the host lock and its line, the ledger, the pipeline freezes): the queue runs and learns from what they say. Use " +
    'the commands that keep them (`teamrig queue`, `teamrig withdraw`, `teamrig pipeline`), and read a file with a ' +
    'read tool. Do not retry this or route around it: a file that looks wrong goes to the lead.'
  );
}

/** The guard's reply to a call: a refusal when it writes a delivery file, else none. */
export function deliveryWriteGuardReply(event: HookEvent, places: DeliveryWritePlaces): HookReply | undefined {
  const reach = deliveryWriteReach(event, places);
  return reach === undefined ? undefined : refusal(deliveryWriteReason(reach));
}
