import { changedFrame, DOCUMENTS, helloFrame, isDocumentName, movedDocuments, type DocumentName, type DocumentRevision } from '../../interface/index.ts';
import { UsageError, type ParsedArgs } from '../args.ts';
import { EXIT, RefusedError, type CliRuntime, type ExitCode } from '../runtime.ts';
import { documentFlagsOf, revisionOf, scopeFlagsOf, sourcesOf, type ReadRequest } from './read.ts';
import type { DocumentSource } from './read-source.ts';
import type { FolderWatch } from '../../core/folder-signals.ts';
import { ReachedFolders } from '../../core/reached-folders.ts';
import { resolveKitHome } from '../../core/home.ts';
import { KIT_VERSION } from '../../core/version.ts';
import { CurrentVersionReader, newerVersion } from '../../kit/newer-current.ts';

/** How long the follower waits between two looks at its documents' files; every change inside one wait is one frame. */
export const EVENTS_PASS_MS = 1_000;

/** The longest the follower goes without a look while its folders tell of no change, for a change they missed. */
export const EVENTS_FALLBACK_MS = 30_000;

const DOCUMENTS_FORM = `--documents takes <document>[,<document>...]; the documents are ${DOCUMENTS.join(', ')}`;

/**
 * `teamrig events --json`: the events side of the public interface (docs/design/public-interface.md), as a follower
 * a program starts and reads. Each frame is one JSON line on stdout and nothing else is ever written there: `hello`
 * first, naming every followed document with its revision, then a `changed` frame naming the documents whose
 * revision moved, at most one each {@link EVENTS_PASS_MS}. A frame names documents and revisions only, so the reader
 * runs `read --unless` for what it wants of them. A refusal goes to stderr before the first frame, as `read`'s does.
 *
 * It looks only at the stamps `read` hashes a revision from: it folds no register, builds no document, and writes no
 * file, no mark and no lock. It ends with exit 0 once the process that started it is gone or its stdout's reader is;
 * the reader's end is seen only at a frame's write, so with nothing changing it is the starter's end that stops it.
 * It also ends with exit 0, an `ENDED` line on stderr, once `<kit home>/current` moves to a version newer than its own
 * (T5813): a follower left on an old version after an update ran on for days. A version current already named at its
 * start ends nothing, so a reader whose CLI lags the kit (a plugin cache not yet updated) is never ended in a loop;
 * the reader starts it again, from wherever it finds the CLI then.
 *
 * The scope is opened once: a config edit moves every revision, but the sessions and paths the follower holds are
 * the ones it started with until it is started again. A revision it then names may differ from the one `read`
 * answers, which costs the reader one full answer and nothing else.
 */
export async function events(args: ParsedArgs, runtime: CliRuntime): Promise<ExitCode> {
  const request = requestOf(args, runtime);
  const reached = new ReachedFolders(runtime.files);
  let sources: ReadonlyMap<DocumentName, DocumentSource>;
  try {
    ({ sources } = await sourcesOf(request, { ...runtime, files: reached }));
  } catch (error) {
    if (error instanceof RefusedError) {
      runtime.out.stderr(`REFUSED ${error.message}`);
      return EXIT.refused;
    }
    throw error;
  }
  const watching = await runtime.starters.watch();
  const ended = (): boolean => watching.stop.aborted || runtime.out.closed?.aborted === true;
  const looks = new Looks(runtime, reached, sources, resolveKitHome(runtime.env, runtime.userHome));
  try {
    const first = await looks.look();
    let held = first.revisions;
    runtime.out.stdout(JSON.stringify(helloFrame(held)));
    while (!ended()) {
      await runtime.sleep(EVENTS_PASS_MS);
      if (ended()) {
        break;
      }
      if (!looks.due()) {
        continue;
      }
      const { revisions: now, current } = await looks.look();
      const superseding = current === first.current ? undefined : newerVersion(current, KIT_VERSION);
      if (superseding !== undefined) {
        runtime.out.stderr(`ENDED teamrig ${superseding} is installed, and this follower ran ${KIT_VERSION}; start it again`);
        return EXIT.ok;
      }
      const frame = changedFrame(movedDocuments(held, now));
      if (frame !== undefined) {
        runtime.out.stdout(JSON.stringify(frame));
      }
      held = now;
    }
    return EXIT.ok;
  } finally {
    looks.close();
    watching.close();
  }
}

/** What one look found. */
interface Look {
  readonly revisions: DocumentRevision[];
  /** The version `<kit home>/current` names, undefined when none is. */
  readonly current: string | undefined;
}

/**
 * When the follower looks at its files again (T5758). A look stamps each file every document reads, which over a
 * tree of teams is hundreds of files, so an idle follower looks only once a watched folder tells of a change, or
 * every second while any folder it reads cannot be watched, and in any case every {@link EVENTS_FALLBACK_MS}, for a
 * change the system did not tell of. The folders are those the last look reached, watched again whenever they differ.
 */
class Looks {
  private readonly runtime: Pick<CliRuntime, 'folderSignals' | 'clock'>;
  private readonly reached: ReachedFolders;
  private readonly sources: ReadonlyMap<DocumentName, DocumentSource>;
  private readonly current: CurrentVersionReader;
  private watch: FolderWatch | undefined;
  private folders: readonly string[] = [];
  private signalled = false;
  private lastLookAt = 0;

  constructor(
    runtime: Pick<CliRuntime, 'folderSignals' | 'clock'>,
    reached: ReachedFolders,
    sources: ReadonlyMap<DocumentName, DocumentSource>,
    kitHome: string,
  ) {
    this.runtime = runtime;
    this.reached = reached;
    this.sources = sources;
    this.current = new CurrentVersionReader(reached, kitHome);
  }

  /** Whether a look is due now. */
  due(): boolean {
    const unwatched = this.watch === undefined || this.watch.unwatched().length > 0;
    return this.signalled || unwatched || this.runtime.clock.now() - this.lastLookAt >= EVENTS_FALLBACK_MS;
  }

  /**
   * Every document's revision now and the version `<kit home>/current` names, watching the folders this look reached
   * when they differ from the last look's: the kit home's among them, so an install wakes the follower as a change does.
   */
  async look(): Promise<Look> {
    this.signalled = false;
    const { value, folders } = await this.reached.record(async () => ({
      revisions: await revisionsOf(this.sources),
      current: await this.current.version(),
    }));
    this.lastLookAt = this.runtime.clock.now();
    if (this.watch === undefined || !sameFolders(folders, this.folders)) {
      this.watch?.close();
      this.folders = folders;
      this.watch = this.runtime.folderSignals.watch(folders, () => {
        this.signalled = true;
      });
      // A change after this look stamped its file but before its folder was watched would go untold: look once more.
      this.signalled = true;
    }
    return value;
  }

  close(): void {
    this.watch?.close();
    this.watch = undefined;
  }
}

function sameFolders(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((folder, index) => folder === other[index]);
}

function requestOf(args: ParsedArgs, runtime: CliRuntime): ReadRequest {
  const [extra] = args.positionals;
  if (extra !== undefined) {
    throw new UsageError(`unexpected "${extra}": events names its documents with --documents`);
  }
  if (!args.switches.has('json')) {
    throw new UsageError('events answers only as JSON in interface 1: add --json');
  }
  const documents = documentsOf(args.flags.get('documents'), args.flags.has('task'));
  return { documents, ...scopeFlagsOf(args, runtime.env), ...documentFlagsOf(args, documents), unless: new Map(), speaks: undefined };
}

/**
 * `--documents`: the documents to follow, each once. With the flag left out, every document of the interface, but
 * `history` only when `--task` names its task: `history` is one task's, so with no task it would refuse the whole run.
 */
function documentsOf(typed: string | undefined, taskNamed: boolean): readonly DocumentName[] {
  if (typed === undefined) {
    return taskNamed ? DOCUMENTS : DOCUMENTS.filter((name) => name !== 'history');
  }
  const documents: DocumentName[] = [];
  for (const name of typed.split(',')) {
    if (!isDocumentName(name)) {
      throw new UsageError(`${DOCUMENTS_FORM}; got "${name}"`);
    }
    if (documents.includes(name)) {
      throw new UsageError(`--documents names ${name} twice`);
    }
    documents.push(name);
  }
  return documents;
}

/**
 * Each followed document with its revision now. A document whose files could not be stamped (a permission refused,
 * a disk gone) is named with no revision, which differs from any it held: the reader then reads it and is told why.
 */
async function revisionsOf(sources: ReadonlyMap<DocumentName, DocumentSource>): Promise<DocumentRevision[]> {
  const revisions: DocumentRevision[] = [];
  for (const [document, source] of sources) {
    revisions.push({ document, revision: await revisionOrNull(source) });
  }
  return revisions;
}

async function revisionOrNull(source: DocumentSource): Promise<string | null> {
  try {
    return revisionOf(await source.parts());
  } catch {
    return null;
  }
}
